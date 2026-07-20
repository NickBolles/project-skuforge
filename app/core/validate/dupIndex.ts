import { normalizeSku } from "./normalize";
import type {
  DuplicateGroup,
  DupIndexEntry,
  IndexedSkuInput,
  NormalizeSkuOptions,
} from "./types";

export class DupIndex {
  readonly normalization: Readonly<NormalizeSkuOptions>;
  private readonly buckets = new Map<string, Map<string, DupIndexEntry>>();
  private readonly byVariant = new Map<string, DupIndexEntry>();
  private reservationOrdinal = 0;

  constructor(normalization: NormalizeSkuOptions = {}) {
    this.normalization = { ...normalization };
  }

  static async from(
    batches: AsyncIterable<readonly IndexedSkuInput[]>,
    normalization: NormalizeSkuOptions = {},
  ): Promise<DupIndex> {
    const index = new DupIndex(normalization);
    for await (const batch of batches) index.addBatch(batch);
    return index;
  }

  get size(): number {
    return this.byVariant.size;
  }

  normalize(value: string): string {
    return normalizeSku(value, this.normalization);
  }

  add(input: IndexedSkuInput): void {
    this.remove(input.variantId);
    if (input.sku === null || input.sku === undefined) return;
    const normalizedSku = this.normalize(input.sku);
    if (normalizedSku === "") return;

    const entry: DupIndexEntry = {
      variantId: input.variantId,
      sku: input.sku,
      normalizedSku,
    };
    const bucket =
      this.buckets.get(normalizedSku) ?? new Map<string, DupIndexEntry>();
    bucket.set(input.variantId, entry);
    this.buckets.set(normalizedSku, bucket);
    this.byVariant.set(input.variantId, entry);
  }

  addBatch(batch: readonly IndexedSkuInput[]): void {
    for (const input of batch) this.add(input);
  }

  reserve(sku: string, ownerId?: string): string {
    const variantId = ownerId ?? `@proposal:${++this.reservationOrdinal}`;
    this.add({ variantId, sku });
    return variantId;
  }

  remove(variantId: string): boolean {
    const existing = this.byVariant.get(variantId);
    if (!existing) return false;
    const bucket = this.buckets.get(existing.normalizedSku);
    bucket?.delete(variantId);
    if (bucket?.size === 0) this.buckets.delete(existing.normalizedSku);
    this.byVariant.delete(variantId);
    return true;
  }

  has(sku: string, exceptVariantId?: string): boolean {
    const bucket = this.buckets.get(this.normalize(sku));
    if (!bucket || bucket.size === 0) return false;
    if (exceptVariantId === undefined) return true;
    return bucket.size > 1 || !bucket.has(exceptVariantId);
  }

  entries(sku: string): DupIndexEntry[] {
    return [...(this.buckets.get(this.normalize(sku))?.values() ?? [])];
  }

  groups(): DuplicateGroup[] {
    const groups: DuplicateGroup[] = [];
    for (const [normalizedSku, bucket] of this.buckets) {
      if (bucket.size > 1) {
        groups.push({ normalizedSku, variants: [...bucket.values()] });
      }
    }
    return groups;
  }
}
