import campaignSender from "../services/campaign-sender.service";
import logger from "../utils/logger";
import { runHealthSweep } from "./health-sweep.job";
import { runReputationRecovery } from "./reputation-recovery.job";
import { runVerifyDomains } from "./verify-domains.job";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

export interface ScheduledJob {
  // Stable id, also the BullMQ job-scheduler id + job name. Never change once
  // deployed (it keys the repeatable schedule in Redis).
  name: string;
  everyMs: number;
  handler: () => Promise<void>;
}

const runCampaignScheduler = async (): Promise<void> => {
  try {
    await campaignSender.tick();
  } catch (err) {
    logger.warn(`campaign scheduler failed: ${String(err)}`);
  }
};

// The single source of truth for every recurring sweep. Adding a job = one entry here; the
// scheduler (BullMQ or the interval fallback) picks it up. All are idempotent "find due rows,
// process" sweeps, so re-running under a durable scheduler is safe. (The SES events SQS
// consumer is NOT here: it is a durable long-poll consumer with its own lifecycle.)
export const SCHEDULED_JOBS: ScheduledJob[] = [
  // Starts campaigns whose time has come, and keeps SENDING campaigns moving.
  { name: "campaign-scheduler", everyMs: 30 * SECOND, handler: runCampaignScheduler },
  { name: "verify-domains", everyMs: 1 * MINUTE, handler: runVerifyDomains },
  { name: "reputation-recovery", everyMs: 10 * MINUTE, handler: runReputationRecovery },
  { name: "health-sweep", everyMs: 24 * HOUR, handler: runHealthSweep },
];
