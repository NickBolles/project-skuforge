import { Prisma, type JobLock, type PrismaClient } from "@prisma/client";

type LockDb = Pick<PrismaClient, "jobLock" | "$transaction">;
export const DEFAULT_STALE_LOCK_MS = 10 * 60 * 1000;

export class JobLockedError extends Error {
  constructor(readonly lock: JobLock) {
    super(`A ${lock.kind} job is already running (${lock.jobId}).`);
    this.name = "JobLockedError";
  }
}

function uniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function acquireJobLock(
  db: LockDb,
  input: { shopId: string; jobId: string; kind: string; now?: Date; staleAfterMs?: number },
): Promise<{ lock: JobLock; reapedStale: boolean }> {
  const now = input.now ?? new Date();
  const staleBefore = new Date(now.getTime() - (input.staleAfterMs ?? DEFAULT_STALE_LOCK_MS));
  try {
    const lock = await db.jobLock.create({ data: { shopId: input.shopId, jobId: input.jobId, kind: input.kind, acquiredAt: now, heartbeatAt: now } });
    return { lock, reapedStale: false };
  } catch (error) {
    if (!uniqueViolation(error)) throw error;
  }

  const removed = await db.jobLock.deleteMany({
    where: { shopId: input.shopId, heartbeatAt: { lt: staleBefore } },
  });
  if (removed.count > 0) {
    try {
      const lock = await db.jobLock.create({ data: { shopId: input.shopId, jobId: input.jobId, kind: input.kind, acquiredAt: now, heartbeatAt: now } });
      return { lock, reapedStale: true };
    } catch (error) {
      if (!uniqueViolation(error)) throw error;
    }
  }
  const held = await db.jobLock.findUnique({ where: { shopId: input.shopId } });
  if (!held) return acquireJobLock(db, input);
  throw new JobLockedError(held);
}

export async function heartbeatJobLock(db: LockDb, shopId: string, jobId: string, now = new Date()): Promise<void> {
  const updated = await db.jobLock.updateMany({ where: { shopId, jobId }, data: { heartbeatAt: now } });
  if (updated.count !== 1) throw new Error(`Job ${jobId} no longer owns the shop lock.`);
}

export async function releaseJobLock(db: LockDb, shopId: string, jobId: string): Promise<void> {
  await db.jobLock.deleteMany({ where: { shopId, jobId } });
}
