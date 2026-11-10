import { Queue, Worker } from "bullmq";
import logger from "../utils/logger";
import { closeQueueConnections, createQueueConnection, isQueueEnabled } from "./connection";

// Background work that is triggered by a request rather than by the clock: CSV imports and
// campaign sending. With Redis this is a BullMQ queue (durable, retried, one job per id);
// without Redis (tests, a bare dev run) the handler runs in-process: awaited under tests so
// they are deterministic, on the next tick otherwise.

export type WorkJob = { kind: "import"; id: string } | { kind: "campaign"; id: string };
type Handler = (id: string) => Promise<void>;

const QUEUE_NAME = "mail-work";
const handlers = new Map<WorkJob["kind"], Handler>();
let queue: Queue | null = null;
let worker: Worker | null = null;

const underTest = (): boolean => process.env.VITEST === "true" || process.env.NODE_ENV === "test";

export const registerHandler = (kind: WorkJob["kind"], fn: Handler): void => {
  handlers.set(kind, fn);
};

const run = async (job: WorkJob): Promise<void> => {
  const h = handlers.get(job.kind);
  if (!h) throw new Error(`no handler for ${job.kind}`);
  await h(job.id);
};

const getQueue = (): Queue => {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: createQueueConnection(),
      defaultJobOptions: { removeOnComplete: true, removeOnFail: 200, attempts: 3, backoff: { type: "exponential", delay: 5000 } },
    });
  }
  return queue;
};

/** Hands work to the queue (or runs it in-process when there is none). */
export const enqueue = async (job: WorkJob, opts: { delayMs?: number } = {}): Promise<void> => {
  if (!isQueueEnabled()) {
    if (underTest()) return run(job);
    setTimeout(() => void run(job).catch((e) => logger.warn(`${job.kind} ${job.id} failed: ${String(e)}`)), opts.delayMs ?? 0);
    return;
  }
  // The job id dedupes: one waiting or active job per import or campaign.
  await getQueue().add(job.kind, job, { jobId: `${job.kind}-${job.id}`, delay: opts.delayMs });
};

export const startWorker = (): void => {
  if (!isQueueEnabled() || worker) return;
  worker = new Worker(QUEUE_NAME, async (j) => run(j.data as WorkJob), {
    connection: createQueueConnection(),
    concurrency: 4,
  });
  worker.on("failed", (j, err) => logger.warn(`work job ${j?.name ?? "?"} failed: ${err.message}`));
  worker.on("error", (err) => logger.warn(`work worker error: ${err.message}`));
  logger.info("Work queue started (imports, campaign sending)");
};

export const stopWorker = async (): Promise<void> => {
  if (worker) await worker.close();
  if (queue) await queue.close();
  worker = null;
  queue = null;
  await closeQueueConnections();
};
