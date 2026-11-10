import { sql } from "kysely";
import config from "../config";
import { db } from "../db/connection";
import type { email_sending_status } from "../db/enums";
import emailReputationRepository from "../repositories/email-reputation.repository";
import logger from "../utils/logger";

export interface ReputationRates {
  /** Messages handed to the provider in the window. */
  sends: number;
  delivered: number;
  /** Permanent bounces (the ones that count against reputation). */
  bounces: number;
  /** Every bounce, soft ones included. */
  allBounces: number;
  complaints: number;
  bounceRate: number;
  permanentBounceRate: number;
  complaintRate: number;
}

const WINDOW_DAYS = 14;

// Act only once a tenant has meaningful volume, so a single early bounce does not pause a
// brand-new domain. Configurable so the integration tests can trip a tier with few sends.
export const MIN_SENDS_FOR_ACTION = config.EMAIL_REPUTATION_MIN_SENDS;

// A status is the worst tier whose bound is crossed.
export const BOUNCE = {
  WARNING: config.EMAIL_REPUTATION_BOUNCE_WARN,
  THROTTLED: (config.EMAIL_REPUTATION_BOUNCE_WARN + config.EMAIL_REPUTATION_BOUNCE_PAUSE) / 2,
  PAUSED: config.EMAIL_REPUTATION_BOUNCE_PAUSE,
};
export const COMPLAINT = {
  WARNING: config.EMAIL_REPUTATION_COMPLAINT_WARN,
  THROTTLED: (config.EMAIL_REPUTATION_COMPLAINT_WARN + config.EMAIL_REPUTATION_COMPLAINT_PAUSE) / 2,
  PAUSED: config.EMAIL_REPUTATION_COMPLAINT_PAUSE,
};

// Maps rolling rates to a sending status. Returns ACTIVE below the action volume or when
// rates are clean.
export const tierFor = (
  rates: Pick<ReputationRates, "sends" | "bounceRate" | "complaintRate">,
  minSends: number = MIN_SENDS_FOR_ACTION
): email_sending_status => {
  if (rates.sends < minSends) return "ACTIVE";
  if (rates.bounceRate >= BOUNCE.PAUSED || rates.complaintRate >= COMPLAINT.PAUSED) return "PAUSED";
  if (rates.bounceRate >= BOUNCE.THROTTLED || rates.complaintRate >= COMPLAINT.THROTTLED) return "THROTTLED";
  if (rates.bounceRate >= BOUNCE.WARNING || rates.complaintRate >= COMPLAINT.WARNING) return "WARNING";
  return "ACTIVE";
};

const RANK: Record<email_sending_status, number> = { ACTIVE: 0, WARNING: 1, THROTTLED: 2, PAUSED: 3 };
const ORDER: email_sending_status[] = ["ACTIVE", "WARNING", "THROTTLED", "PAUSED"];

// Wait this long after a status change before auto-recovering one level.
const RECOVERY_COOLDOWN_MS = 48 * 60 * 60 * 1000;

const reason = (r: ReputationRates): string =>
  `sends=${r.sends} bounceRate=${(r.bounceRate * 100).toFixed(2)}% complaintRate=${(r.complaintRate * 100).toFixed(3)}%`;

type PauseHook = (tenantId: string, reason: string) => Promise<void>;

// Rates come from the database (email_messages over a rolling 14 days), so they survive a
// Redis flush and work in every environment. The service also owns the degrade (after a
// bounce or complaint), recovery (sweep) and manual unpause transitions, which persist to
// tenants.email_sending_status and email_reputation_events.
class ReputationService {
  private pauseHook: PauseHook | null = null;

  /** The campaign pipeline registers itself here to freeze in-flight sends on PAUSED. */
  onPaused(hook: PauseHook): void {
    this.pauseHook = hook;
  }

  async getRates(tenantId: string): Promise<ReputationRates> {
    const row = await db
      .selectFrom("email_messages")
      .select([
        sql<string>`count(*)`.as("sends"),
        sql<string>`count(*) filter (where delivered_at is not null)`.as("delivered"),
        sql<string>`count(*) filter (where bounce_type = 'Permanent')`.as("hard"),
        sql<string>`count(*) filter (where bounced_at is not null)`.as("bounced"),
        sql<string>`count(*) filter (where complained_at is not null)`.as("complained"),
      ])
      .where("tenant_id", "=", tenantId)
      .where("sent_at", ">=", new Date(Date.now() - WINDOW_DAYS * 86400000))
      .executeTakeFirst();
    const sends = Number(row?.sends ?? 0);
    const hard = Number(row?.hard ?? 0);
    const all = Number(row?.bounced ?? 0);
    const complaints = Number(row?.complained ?? 0);
    return {
      sends,
      delivered: Number(row?.delivered ?? 0),
      bounces: hard,
      allBounces: all,
      complaints,
      bounceRate: sends ? all / sends : 0,
      permanentBounceRate: sends ? hard / sends : 0,
      complaintRate: sends ? complaints / sends : 0,
    };
  }

  // Degrade only: called after a bounce/complaint. Moves the tenant to a worse tier when
  // rates cross a threshold; never recovers here. `bounceRate` for tiering is the permanent one.
  async evaluateAndApply(tenantId: string, trigger: string): Promise<void> {
    const rates = await this.getRates(tenantId);
    const target = tierFor({ sends: rates.sends, bounceRate: rates.permanentBounceRate, complaintRate: rates.complaintRate });
    const state = await emailReputationRepository.getTenantState(tenantId);
    if (!state) return;
    if (RANK[target] > RANK[state.email_sending_status]) {
      await emailReputationRepository.setTenantStatus(tenantId, target);
      await emailReputationRepository.recordEvent({
        tenantId,
        fromStatus: state.email_sending_status,
        toStatus: target,
        trigger,
        reason: reason(rates),
        ratesSnapshot: rates,
      });
      logger.warn(`reputation: tenant ${tenantId} ${state.email_sending_status} -> ${target} (${reason(rates)})`);
      if (target === "PAUSED" && this.pauseHook) await this.pauseHook(tenantId, "Tenant sending paused");
    }
  }

  // Recovery sweep: step WARNING/THROTTLED tenants up one level once the cooldown has
  // passed and rates have cleared. PAUSED is left for an operator.
  async recoverAll(): Promise<void> {
    const tenants = await emailReputationRepository.listRecoverable();
    const now = Date.now();
    for (const t of tenants) {
      const changedAt = t.email_sending_status_changed_at ? new Date(t.email_sending_status_changed_at).getTime() : 0;
      if (now - changedAt < RECOVERY_COOLDOWN_MS) continue;
      const rates = await this.getRates(t.id);
      const target = tierFor({ sends: rates.sends, bounceRate: rates.permanentBounceRate, complaintRate: rates.complaintRate });
      if (RANK[target] >= RANK[t.email_sending_status]) continue;
      const next = ORDER[RANK[t.email_sending_status] - 1];
      await emailReputationRepository.setTenantStatus(t.id, next);
      await emailReputationRepository.recordEvent({
        tenantId: t.id,
        fromStatus: t.email_sending_status,
        toStatus: next,
        trigger: "recovery",
        reason: reason(rates),
        ratesSnapshot: rates,
      });
      logger.info(`reputation recovery: tenant ${t.id} ${t.email_sending_status} -> ${next}`);
    }
  }

  /** Operator action: set the tenant back to ACTIVE with a recorded reason. Returns the previous status. */
  async manualUnpause(tenantId: string, actorEmail: string, why: string): Promise<email_sending_status> {
    const state = await emailReputationRepository.getTenantState(tenantId);
    if (!state) throw new Error("tenant not found");
    if (state.email_sending_status !== "ACTIVE") {
      await emailReputationRepository.setTenantStatus(tenantId, "ACTIVE");
      await emailReputationRepository.recordEvent({
        tenantId,
        fromStatus: state.email_sending_status,
        toStatus: "ACTIVE",
        trigger: "operator_unpause",
        reason: `${actorEmail}: ${why}`.slice(0, 500),
        ratesSnapshot: null,
      });
    }
    return state.email_sending_status;
  }
}

export default new ReputationService();
