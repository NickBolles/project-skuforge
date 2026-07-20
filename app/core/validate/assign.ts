import type { DupIndex } from "./dupIndex";
import type {
  CollisionStrategy,
  SequenceCollisionStrategy,
  UniqueAssignment,
} from "./types";

const DEFAULT_SEQUENCE_ATTEMPTS = 100;
const DEFAULT_SUFFIX_ATTEMPTS = 10_000;

export class UniqueAssignmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UniqueAssignmentError";
  }
}

function positiveBound(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return resolved;
}

function assertCandidate(candidate: string): void {
  if (candidate.trim() === "") {
    throw new UniqueAssignmentError("Cannot assign an empty SKU.");
  }
}

function reserve(
  candidate: string,
  index: DupIndex,
  ownerId: string | undefined,
  collisionsResolved: number,
  resolution: UniqueAssignment["resolution"],
  sequence?: number,
): UniqueAssignment {
  index.reserve(candidate, ownerId);
  return {
    sku: candidate,
    normalizedSku: index.normalize(candidate),
    collisionsResolved,
    resolution,
    ...(sequence === undefined ? {} : { sequence }),
  };
}

/**
 * Assigns and immediately reserves a value in the supplied index. Therefore
 * sequential calls sharing one index are collision-safe for existing and
 * proposed values. Store-wide safety remains index-relative: later write jobs
 * must serialize per shop, point-check interactive writes, and verify after a
 * run because Shopify itself does not enforce SKU uniqueness.
 */
export function assignUnique(
  proposedSku: string,
  index: DupIndex,
  strategy: CollisionStrategy = {},
): UniqueAssignment {
  assertCandidate(proposedSku);
  const ownerId = strategy.ownerId;
  if (!index.has(proposedSku, ownerId)) {
    return reserve(proposedSku, index, ownerId, 0, "none");
  }

  let collisionsResolved = 1;
  if (strategy.type === "sequence") {
    const sequenceStrategy = strategy as SequenceCollisionStrategy;
    if (
      !Number.isSafeInteger(sequenceStrategy.nextSequence) ||
      sequenceStrategy.nextSequence < 0
    ) {
      throw new RangeError("nextSequence must be a non-negative safe integer");
    }
    const attempts = positiveBound(
      sequenceStrategy.maxSequenceAttempts,
      DEFAULT_SEQUENCE_ATTEMPTS,
      "maxSequenceAttempts",
    );
    for (let offset = 0; offset < attempts; offset += 1) {
      const sequence = sequenceStrategy.nextSequence + offset;
      if (!Number.isSafeInteger(sequence)) break;
      const candidate = sequenceStrategy.render(sequence);
      assertCandidate(candidate);
      if (!index.has(candidate, ownerId)) {
        return reserve(
          candidate,
          index,
          ownerId,
          collisionsResolved,
          "sequence",
          sequence,
        );
      }
      collisionsResolved += 1;
    }
  }

  const separator = strategy.suffixSeparator ?? "-";
  const suffixAttempts = positiveBound(
    strategy.maxSuffixAttempts,
    DEFAULT_SUFFIX_ATTEMPTS,
    "maxSuffixAttempts",
  );
  for (let ordinal = 2; ordinal < 2 + suffixAttempts; ordinal += 1) {
    const candidate = `${proposedSku}${separator}${ordinal}`;
    if (!index.has(candidate, ownerId)) {
      return reserve(candidate, index, ownerId, collisionsResolved, "suffix");
    }
    collisionsResolved += 1;
  }

  throw new UniqueAssignmentError(
    `Unable to assign a unique SKU after ${collisionsResolved} collisions.`,
  );
}
