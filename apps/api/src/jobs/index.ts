import { startWorker, stopWorker } from "../queue/work";
import logger from "../utils/logger";
import { startScheduler, stopScheduler } from "./scheduler";
import { startEventsConsumer, stopEventsConsumer } from "./ses-events.consumer";
// Importing these registers their queue handlers (imports, campaign sending).
import "../services/campaign-sender.service";
import "../services/imports.service";

// Background work runs on the single jobs worker (the one started with RUN_JOBS=true). The
// recurring sweeps are driven by a durable BullMQ scheduler, or an in-process interval
// fallback when Redis is absent (see scheduler.ts). Imports and campaign sending run on the
// "mail-work" queue; the SES events SQS consumer keeps its own long-poll lifecycle.
export const startJobs = async (): Promise<void> => {
  startEventsConsumer();
  startWorker();
  await startScheduler();
  logger.info(`Background jobs started on worker ${process.pid}`);
};

export const stopJobs = async (): Promise<void> => {
  stopEventsConsumer();
  await stopWorker();
  await stopScheduler();
};
