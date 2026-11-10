import config from "../config";
import { db } from "../db/connection";
import type { email_category } from "../db/enums";
import { BadRequestError, ConflictError, NotFoundError } from "../errors";
import { toSenderDto } from "../presenters/senders";
import emailDomainsRepository from "../repositories/email-domains.repository";
import emailIdentitiesRepository from "../repositories/email-identities.repository";
import { escapeHtml } from "../utils/render";
import { EMAIL_RE } from "../presenters/common";
import auditService from "./audit.service";
import emailResolverService from "./email-resolver.service";
import mailerService from "./mailer.service";

const CATEGORIES: email_category[] = ["TRANSACTIONAL", "NOTIFICATION", "MARKETING"];
const LOCAL_RE = /^[a-z0-9][a-z0-9._+-]{0,63}$/;

interface DefaultFlags {
  is_default_transactional: boolean;
  is_default_notification: boolean;
  is_default_marketing: boolean;
}

const flagFor = (category: email_category): keyof DefaultFlags =>
  category === "TRANSACTIONAL"
    ? "is_default_transactional"
    : category === "MARKETING"
      ? "is_default_marketing"
      : "is_default_notification";

const defaultFlags = (defaults?: unknown): DefaultFlags => {
  const set = new Set((Array.isArray(defaults) ? defaults : []).map((c) => String(c).toUpperCase()));
  for (const c of set) {
    if (!CATEGORIES.includes(c as email_category)) throw new BadRequestError(`Invalid category: ${c}`);
  }
  return {
    is_default_transactional: set.has("TRANSACTIONAL"),
    is_default_notification: set.has("NOTIFICATION"),
    is_default_marketing: set.has("MARKETING"),
  };
};

class EmailIdentitiesService {
  async list(tenantId: string) {
    return (await emailIdentitiesRepository.listByTenant(tenantId)).map(toSenderDto);
  }

  async create(
    tenantId: string,
    actorId: string,
    body: { domainId?: string; localPart?: string; displayName?: string; replyTo?: string; defaults?: string[] }
  ) {
    if (!body.domainId) throw new BadRequestError("domainId is required");
    const local = String(body.localPart ?? "").trim().toLowerCase();
    if (!LOCAL_RE.test(local)) throw new BadRequestError("localPart must be the part before the @, such as hello");
    const replyTo = body.replyTo?.trim().toLowerCase();
    if (replyTo && !EMAIL_RE.test(replyTo)) throw new BadRequestError("replyTo must be an email address");

    const domain = await emailDomainsRepository.findById(body.domainId, tenantId);
    if (!domain) throw new NotFoundError("Sending domain not found");
    if (domain.status !== "VERIFIED") {
      throw new BadRequestError("The sending domain must be verified before adding senders");
    }
    const email = `${local}@${domain.subdomain}`;
    if (await emailIdentitiesRepository.findByEmail(tenantId, email)) {
      throw new ConflictError("That sender address already exists");
    }
    const defaults = defaultFlags(body.defaults);

    const identity = await db.transaction().execute(async (trx) => {
      for (const category of CATEGORIES) {
        if (defaults[flagFor(category)]) await emailIdentitiesRepository.clearDefault(tenantId, category, trx);
      }
      return emailIdentitiesRepository.create(
        {
          tenant_id: tenantId,
          sending_domain_id: domain.id,
          email_address: email,
          display_name: body.displayName?.trim().slice(0, 100) || null,
          reply_to: replyTo || null,
          ...defaults,
        },
        trx
      );
    });
    auditService.record(tenantId, actorId, "email_identity.created", "email_sender_identity", identity.id, { email });
    emailResolverService.invalidate(tenantId);
    return toSenderDto(identity);
  }

  async update(
    tenantId: string,
    actorId: string,
    id: string,
    body: { displayName?: string | null; replyTo?: string | null; status?: string; defaults?: string[] }
  ) {
    const current = await emailIdentitiesRepository.findById(id, tenantId);
    if (!current) throw new NotFoundError("Sender identity not found");

    const patch: Parameters<typeof emailIdentitiesRepository.update>[2] = {};
    if (body.displayName !== undefined) patch.display_name = body.displayName?.trim().slice(0, 100) || null;
    if (body.replyTo !== undefined) {
      const r = body.replyTo?.trim().toLowerCase() || null;
      if (r && !EMAIL_RE.test(r)) throw new BadRequestError("replyTo must be an email address");
      patch.reply_to = r;
    }
    if (body.status !== undefined) {
      const st = String(body.status).toUpperCase();
      if (st !== "ACTIVE" && st !== "ARCHIVED") throw new BadRequestError("Invalid status");
      patch.status = st;
    }
    const defaults = body.defaults !== undefined ? defaultFlags(body.defaults) : null;
    if (defaults) Object.assign(patch, defaults);

    const updated = await db.transaction().execute(async (trx) => {
      if (defaults) {
        for (const category of CATEGORIES) {
          if (defaults[flagFor(category)]) await emailIdentitiesRepository.clearDefault(tenantId, category, trx);
        }
      }
      return emailIdentitiesRepository.update(id, tenantId, patch, trx);
    });
    auditService.record(tenantId, actorId, "email_identity.updated", "email_sender_identity", id, {});
    emailResolverService.invalidate(tenantId);
    return toSenderDto(updated);
  }

  async remove(tenantId: string, actorId: string, id: string) {
    const current = await emailIdentitiesRepository.findById(id, tenantId);
    if (!current) throw new NotFoundError("Sender identity not found");
    await emailIdentitiesRepository.remove(id, tenantId);
    auditService.record(tenantId, actorId, "email_identity.deleted", "email_sender_identity", id, {});
    emailResolverService.invalidate(tenantId);
    return { id };
  }

  /** Sends a test message from this sender to the signed-in user. Not counted against the quota. */
  async sendTest(tenantId: string, id: string, toEmail: string) {
    if (!(await emailIdentitiesRepository.findById(id, tenantId))) throw new NotFoundError("Sender identity not found");
    const sender = await emailResolverService.resolveIdentity(tenantId, id);
    if (!sender) throw new BadRequestError("This sender is archived or its domain is not verified");
    const result = await mailerService.sendTenant({
      tenantId,
      sender,
      category: "TRANSACTIONAL",
      to: toEmail,
      countTowardQuota: false,
      build: () => ({
        subject: `Test message from ${sender.fromAddress}`,
        html: `<p>This is a test message from ${escapeHtml(sender.fromAddress)}. If you can read it, the sender works.</p>`,
        text: `This is a test message from ${sender.fromAddress}. If you can read it, the sender works.`,
      }),
    });
    return { sentTo: toEmail, status: result.status, simulated: result.status === "sent" ? result.simulated : config.EMAIL_SES_MODE === "simulated" };
  }
}

export default new EmailIdentitiesService();
