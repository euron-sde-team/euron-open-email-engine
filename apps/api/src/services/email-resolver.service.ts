import config from "../config";
import { getRedis } from "../db/redis";
import type { email_category } from "../db/enums";
import emailDomainsRepository from "../repositories/email-domains.repository";
import emailIdentitiesRepository from "../repositories/email-identities.repository";

export interface ResolvedSender {
  fromAddress: string;
  displayName: string | null;
  replyTo: string | null;
  configurationSetName: string | null;
  sendingDomainId: string;
  senderIdentityId: string;
  /** The tenant's own tracking host when its CNAME is verified, else null. */
  trackingDomain: string | null;
}

const CACHE_TTL_SEC = 60;
const CATEGORIES: email_category[] = ["TRANSACTIONAL", "NOTIFICATION", "MARKETING"];

// Resolves a tenant's sender from a VERIFIED sending domain. There is no platform fallback:
// tenant mail (campaigns, confirmations, tests) goes out only from the tenant's own verified
// domain. Category defaults are cached in Redis (60s) and invalidated on any domain or
// identity change; an explicit identity is always read fresh.
class EmailResolverService {
  private key(tenantId: string, category: email_category): string {
    return `resolve:${tenantId}:${category}`;
  }

  invalidate(tenantId: string): void {
    const redis = getRedis();
    if (!redis) return;
    const keys = CATEGORIES.map((c) => this.key(tenantId, c));
    void redis.del(...keys).catch(() => undefined);
  }

  /** A specific identity, usable only when active and on a verified domain. */
  async resolveIdentity(tenantId: string, identityId: string): Promise<ResolvedSender | null> {
    const identity = await emailIdentitiesRepository.findById(identityId, tenantId);
    if (!identity || identity.status !== "ACTIVE") return null;
    return this.fromIdentity(tenantId, identity);
  }

  /** The tenant's default sender for a category, or null when none is usable. */
  async resolveDefault(tenantId: string, category: email_category): Promise<ResolvedSender | null> {
    const redis = getRedis();
    const cacheKey = this.key(tenantId, category);
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) return JSON.parse(cached) as ResolvedSender | null;
      } catch {
        // fall through to compute
      }
    }
    const identity = await emailIdentitiesRepository.findDefault(tenantId, category);
    const value = identity ? await this.fromIdentity(tenantId, identity) : null;
    if (redis) {
      try {
        await redis.set(cacheKey, JSON.stringify(value), "EX", CACHE_TTL_SEC);
      } catch {
        // caching is best-effort
      }
    }
    return value;
  }

  private async fromIdentity(
    tenantId: string,
    identity: NonNullable<Awaited<ReturnType<typeof emailIdentitiesRepository.findById>>>
  ): Promise<ResolvedSender | null> {
    const domain = await emailDomainsRepository.findById(identity.sending_domain_id, tenantId);
    if (!domain || domain.status !== "VERIFIED") return null;
    return {
      fromAddress: identity.email_address,
      displayName: identity.display_name,
      replyTo: identity.reply_to,
      configurationSetName: domain.ses_configuration_set,
      sendingDomainId: domain.id,
      senderIdentityId: identity.id,
      trackingDomain:
        config.EMAIL_TRACKING_CUSTOM_DOMAINS && domain.tracking_status === "VERIFIED"
          ? domain.tracking_domain
          : null,
    };
  }
}

export default new EmailResolverService();
