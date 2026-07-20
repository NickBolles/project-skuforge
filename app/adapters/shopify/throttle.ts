import { CatalogError } from "./catalog";

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface GraphqlErrorShape {
  message: string;
  extensions?: { code?: string };
}

export interface GraphqlCostExtensions {
  requestedQueryCost?: number;
  actualQueryCost?: number;
  throttleStatus?: {
    maximumAvailable: number;
    currentlyAvailable: number;
    restoreRate: number;
  };
}

export interface GraphqlEnvelope<T> {
  data?: T;
  errors?: GraphqlErrorShape[];
  extensions?: { cost?: GraphqlCostExtensions };
}

export interface ThrottledGraphqlClientOptions {
  fetch?: FetchLike;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  maxRetries?: number;
  retryBaseMs?: number;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class ThrottledGraphqlClient {
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private available = Number.POSITIVE_INFINITY;
  private restoreRate = 50;
  private updatedAt = 0;

  constructor(
    private readonly endpoint: string,
    private readonly accessToken: string,
    options: ThrottledGraphqlClientOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
    this.maxRetries = options.maxRetries ?? 5;
    this.retryBaseMs = options.retryBaseMs ?? 250;
    this.updatedAt = this.now();
  }

  get rawFetch(): FetchLike {
    return this.fetchImpl;
  }

  private replenish(): void {
    if (!Number.isFinite(this.available)) return;
    const now = this.now();
    const elapsedSeconds = Math.max(0, now - this.updatedAt) / 1_000;
    this.available += elapsedSeconds * this.restoreRate;
    this.updatedAt = now;
  }

  private async waitForBudget(estimatedCost: number): Promise<void> {
    this.replenish();
    if (!Number.isFinite(this.available) || this.available >= estimatedCost)
      return;
    const waitMs = Math.ceil(
      ((estimatedCost - this.available) / this.restoreRate) * 1_000,
    );
    await this.sleep(waitMs);
    this.available += (waitMs / 1_000) * this.restoreRate;
    this.updatedAt = this.now();
  }

  private updateCost(cost: GraphqlCostExtensions | undefined): void {
    const status = cost?.throttleStatus;
    if (!status) return;
    this.available = status.currentlyAvailable;
    this.restoreRate = Math.max(1, status.restoreRate);
    this.updatedAt = this.now();
  }

  async request<T>(
    query: string,
    variables: Record<string, unknown> = {},
    estimatedCost = 10,
  ): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      await this.waitForBudget(estimatedCost);
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-shopify-access-token": this.accessToken,
        },
        body: JSON.stringify({ query, variables }),
      });
      if (!response.ok) {
        throw new CatalogError(
          "GRAPHQL_ERROR",
          `Shopify GraphQL returned HTTP ${response.status}.`,
        );
      }
      const envelope = (await response.json()) as GraphqlEnvelope<T>;
      this.updateCost(envelope.extensions?.cost);
      const errors = envelope.errors ?? [];
      const throttled = errors.some(
        (error) => error.extensions?.code === "THROTTLED",
      );
      if (throttled && attempt < this.maxRetries) {
        await this.sleep(this.retryBaseMs * 2 ** attempt);
        continue;
      }
      if (errors.length > 0) {
        throw new CatalogError(
          "GRAPHQL_ERROR",
          errors.map((error) => error.message).join("; "),
        );
      }
      if (envelope.data === undefined) {
        throw new CatalogError(
          "GRAPHQL_ERROR",
          "Shopify GraphQL returned no data.",
        );
      }
      return envelope.data;
    }
  }
}
