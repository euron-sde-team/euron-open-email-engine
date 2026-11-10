import { systemResolver } from "../utils/email-dns";
import { db } from "../db/connection";
import emailDomainsRepository from "../repositories/email-domains.repository";
import emailHealthRepository from "../repositories/email-health.repository";
import emailResolverService from "../services/email-resolver.service";
import emailSesClient from "../services/email-ses.client";
import logger from "../utils/logger";

const DAY_MS = 24 * 60 * 60 * 1000;

// Daily re-check of VERIFIED domains. Records a health snapshot; if a domain has
// been broken across two checks spanning more than 24h, it is failed and the
// resolver cache invalidated so campaigns using it pause. Scheduled
// by scheduler.ts.
export async function runHealthSweep(): Promise<void> {
  if (!emailSesClient.isLive()) return;
  try {
    const domains = await db
      .selectFrom("email_sending_domains")
      .select(["id", "tenant_id", "subdomain"])
      .where("status", "=", "VERIFIED")
      .execute();

    for (const d of domains) {
      try {
        const s = await emailSesClient.getIdentity(d.subdomain);
        const [spf, dmarc] = await Promise.all([
          systemResolver.txt(d.subdomain).then((r) => r.some((t) => t.toLowerCase().includes("v=spf1"))),
          systemResolver.txt(`_dmarc.${d.subdomain}`).then((r) => r.some((t) => t.toLowerCase().includes("v=dmarc1"))),
        ]);
        const broken = s.dkimStatus !== "SUCCESS" || s.mailFromStatus !== "SUCCESS";
        const failures = broken ? [`dkim=${s.dkimStatus}`, `mailFrom=${s.mailFromStatus}`] : [];

        const prev = await emailHealthRepository.latest(d.tenant_id, d.id);
        await emailHealthRepository.record({
          tenantId: d.tenant_id,
          sendingDomainId: d.id,
          dkimStatus: s.dkimStatus,
          mailFromStatus: s.mailFromStatus,
          spfPresent: spf,
          dmarcPresent: dmarc,
          failures,
        });

        if (broken && prev) {
          const prevBroken =
            prev.dkim_status !== "SUCCESS" || prev.mail_from_status !== "SUCCESS";
          const prevOld = Date.now() - new Date(prev.created_at).getTime() > DAY_MS;
          if (prevBroken && prevOld) {
            await emailDomainsRepository.update(d.id, d.tenant_id, {
              status: "FAILED",
              dkim_status: s.dkimStatus,
              mail_from_status: s.mailFromStatus,
              last_checked_at: new Date(),
            });
            emailResolverService.invalidate(d.tenant_id);
            logger.warn(`health sweep: domain ${d.subdomain} FAILED (broken > 24h)`);
          }
        }
      } catch (err) {
        logger.warn(`health sweep ${d.subdomain}: ${String(err)}`);
      }
    }
  } catch (err) {
    logger.warn(`health sweep failed: ${String(err)}`);
  }
}
