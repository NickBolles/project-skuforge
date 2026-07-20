import type { PrismaClient } from "@prisma/client";

type SequenceDb = Pick<PrismaClient, "sequenceCounter">;

/** Read-only preview helper. It never creates or advances a counter. */
export async function peekSequence(db: SequenceDb, shopId: string, key: string): Promise<number> {
  const counter = await db.sequenceCounter.findUnique({ where: { shopId_key: { shopId, key } } });
  return counter?.nextValue ?? 1;
}

export interface SequenceBlock {
  start: number;
  endExclusive: number;
  size: number;
}

/** Atomically reserves a gap-tolerant counter block. */
export async function allocateSequenceBlock(
  db: Pick<PrismaClient, "sequenceCounter">,
  shopId: string,
  key: string,
  requestedSize: number,
  initialValue = 1,
): Promise<SequenceBlock> {
  if (!Number.isSafeInteger(requestedSize) || requestedSize < 1) {
    throw new RangeError("Sequence block size must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(initialValue) || initialValue < 0) {
    throw new RangeError("Initial sequence value must be a non-negative safe integer.");
  }
  const counter = await db.sequenceCounter.upsert({
    where: { shopId_key: { shopId, key } },
    create: { shopId, key, nextValue: initialValue + requestedSize },
    update: { nextValue: { increment: requestedSize } },
  });
  const start = counter.nextValue - requestedSize;
  return { start, endExclusive: counter.nextValue, size: requestedSize };
}
