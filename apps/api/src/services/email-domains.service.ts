import config from "../config";
import { LIMIT_CODES } from "../constants/modules.const";
import { BadRequestError, ConflictError, NotFoundError } from "../errors";
import emailDomainsRepository, { EmailSendingDomainRow } from "../repositories/email-domains.repository";
import { toDomainDto, parseDnsRecords } from "../presenters/domains";
import {
  checkRecords,
  computeDnsRecords,
  type DnsRecord,
  type DnsResolver,
  mailFromFor,
  mapDomainStatus,
  normalizeSubdomain,
  systemResolver,
  trackingDomainFor,
} from "../utils/email-dns";
import auditService from "./audit.service";
import emailResolverService from "./email-resolver.service";
import emailSesClient from "./email-ses.client";
import entitlementsService from "./entitlements.service";

let resolver: DnsResolver = systemResolver;
/** Tests inject a fake resolver; pass null to restore the system one. */
export const setDnsResolver = (r: DnsResolver | null): void => {
  resolver = r ?? systemResolver;
};

class EmailDomainsService {
  async list(tenantId: string) {
    return (await emailDomainsRepository.listByTenant(tenantId)).map(toDomainDto);
  }

  async get(tenantId: string, id: string) {
    const row = await emailDomainsRepository.findById(id, tenantId);
    if (!row) throw new NotFoundError("Sending domain not found");
    return toDomainDto(row);
  }

  // Onboard a sending domain: SES configuration set + identity with a custom MAIL FROM,
  // the DNS records the tenant must publish (including SPF/DMARC hints and the tracking
  // CNAME), persisted as PENDING.
  async onboard(tenantId: string, actorId: string, body: { domain?: string; subdomain?: string }) {
    let subdomain: string;
    try {
      subdomain = normalizeSubdomain(body.domain ?? body.subdomain ?? "");
    } catch (err) {
      throw new BadRequestError(err instanceof Error ? err.message : "Invalid domain");
    }

    const count = await emailDomainsRepository.countByTenant(tenantId);
    await entitlementsService.ensureCapacity(tenantId, LIMIT_CODES.DOMAINS, count, 1, "sending domain");
    if (await emailDomainsRepository.existsAnywhere(subdomain)) {
      throw new ConflictError("That domain is already in use");
    }

    const configSet = await emailSesClient.ensureConfigurationSet(tenantId);
    const dkimTokens = await emailSesClient.createIdentity({ subdomain, configSet, tenantId });
    const mailFrom = mailFromFor(subdomain);
    await emailSesClient.putMailFrom(subdomain, mailFrom);
    const initial = await emailSesClient.getIdentity(subdomain);
    const records = computeDnsRecords(subdomain, dkimTokens, config.AWS_SES_REGION, config.EMAIL_TRACKING_HOST);

    const row = await emailDomainsRepository.create({
      tenant_id: tenantId,
      subdomain,
      mail_from_subdomain: mailFrom,
      ses_configuration_set: configSet,
      dkim_status: initial.dkimStatus,
      mail_from_status: initial.mailFromStatus,
      dns_records: records,
      tracking_domain: trackingDomainFor(subdomain),
    });

    auditService.record(tenantId, actorId, "email_domain.created", "email_sending_domain", row.id, { domain: subdomain });
    emailResolverService.invalidate(tenantId);
    return toDomainDto(row);
  }

  /**
   * Refresh a domain: SES status (live) or the simulator, and real DNS lookups through the
   * injectable resolver. In simulated mode "Check now" verifies the domain without DNS so
   * the demo works offline.
   */
  async refresh(row: EmailSendingDomainRow, opts: { explicit: boolean }): Promise<EmailSendingDomainRow> {
    const stored = parseDnsRecords(row.dns_records);
    const ageMs = Date.now() - new Date(row.created_at).getTime();

    let records: DnsRecord[];
    let dkim: string | null;
    let mailFrom: string | null;
    let next = row.status;
    let trackingVerified: boolean;
    let failure: string | null = null;

    if (emailSesClient.isLive()) {
      // Re-ensure the tenant's configuration set and its event destination (SNS topic) so
      // events flow even for domains created before the topic was configured.
      if (config.SES_EVENTS_SNS_TOPIC_ARN) await emailSesClient.ensureConfigurationSet(row.tenant_id);
      const s = await emailSesClient.getIdentity(row.subdomain);
      // Against an AWS emulator (AWS_ENDPOINT_URL) there is no real DNS to look up: the SES
      // status is the truth and each record is reported from it.
      const localAws = Boolean(config.AWS_ENDPOINT_URL);
      records = localAws
        ? stored.map((r) => ({ ...r, found: r.purpose === "TRACKING" ? s.dkimStatus === "SUCCESS" : s.dkimStatus === "SUCCESS" && s.mailFromStatus === "SUCCESS" }))
        : await checkRecords(stored, resolver);
      dkim = s.dkimStatus;
      mailFrom = s.mailFromStatus;
      next = mapDomainStatus(dkim, mailFrom, ageMs);
      trackingVerified = records.find((r) => r.purpose === "TRACKING")?.found === true;
      if (next === "FAILED") failure = "SES could not verify DKIM or MAIL FROM. Check the DNS records below.";
    } else {
      const afterMs = config.EMAIL_DOMAIN_SIMULATE_VERIFY_MINUTES * 60_000;
      const auto = afterMs > 0 && ageMs >= afterMs;
      if (opts.explicit || auto) {
        records = stored.map((r) => ({ ...r, found: true }));
        dkim = "SUCCESS";
        mailFrom = "SUCCESS";
        next = "VERIFIED";
        trackingVerified = true;
      } else {
        records = await checkRecords(stored, resolver);
        dkim = row.dkim_status;
        mailFrom = row.mail_from_status;
        trackingVerified = row.tracking_status === "VERIFIED";
      }
    }

    const updated = await emailDomainsRepository.update(row.id, row.tenant_id, {
      status: next,
      dkim_status: dkim,
      mail_from_status: mailFrom,
      dns_records: records,
      tracking_status: trackingVerified ? "VERIFIED" : "PENDING",
      failure_reason: next === "VERIFIED" ? null : failure,
      last_checked_at: new Date(),
      verified_at: next === "VERIFIED" ? (row.verified_at ?? new Date()) : row.verified_at,
    });
    if (next !== row.status) {
      auditService.record(row.tenant_id, null, `email_domain.${next.toLowerCase()}`, "email_sending_domain", row.id, {
        domain: row.subdomain,
      });
    }
    emailResolverService.invalidate(row.tenant_id);
    return updated;
  }

  async check(tenantId: string, id: string) {
    const row = await emailDomainsRepository.findById(id, tenantId);
    if (!row) throw new NotFoundError("Sending domain not found");
    return toDomainDto(await this.refresh(row, { explicit: true }));
  }

  async remove(tenantId: string, actorId: string, id: string) {
    const row = await emailDomainsRepository.findById(id, tenantId);
    if (!row) throw new NotFoundError("Sending domain not found");
    await emailSesClient.deleteIdentity(row.subdomain);
    await emailDomainsRepository.remove(id, tenantId);
    auditService.record(tenantId, actorId, "email_domain.deleted", "email_sending_domain", id, { domain: row.subdomain });
    emailResolverService.invalidate(tenantId);
    return { id };
  }
}

export default new EmailDomainsService();
