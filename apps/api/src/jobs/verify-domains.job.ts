import { db } from "../db/connection";
import emailDomainsService from "../services/email-domains.service";
import logger from "../utils/logger";

// Re-checks PENDING sending domains: against SES and DNS when live, and in simulated mode
// verifies domains older than EMAIL_DOMAIN_SIMULATE_VERIFY_MINUTES. Scheduled by scheduler.ts.
export async function runVerifyDomains(): Promise<void> {
  try {
    const pending = await db.selectFrom("email_sending_domains").selectAll().where("status", "=", "PENDING").limit(200).execute();
    for (const d of pending) {
      try {
        await emailDomainsService.refresh(d, { explicit: false });
      } catch (err) {
        logger.warn(`verify poll: ${d.subdomain} check failed: ${String(err)}`);
      }
    }
  } catch (err) {
    logger.warn(`verify poll failed: ${String(err)}`);
  }
}
