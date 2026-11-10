import config from "../config";
import { signToken } from "./tokens";

/** Origin that serves /t /u /w /f /c: the tenant's tracking host when enabled, else the API origin. */
export const linkBase = (trackingDomain?: string | null): string =>
  trackingDomain && config.EMAIL_TRACKING_CUSTOM_DOMAINS
    ? `https://${trackingDomain}`
    : config.APP_PUBLIC_URL.replace(/\/$/, "");

export const openPixelUrl = (base: string, messageId: string): string =>
  `${base}/t/o/${signToken({ kind: "o", parts: [messageId] })}.gif`;

export const clickUrl = (base: string, messageId: string, linkToken: string): string =>
  `${base}/t/c/${signToken({ kind: "c", parts: [messageId, linkToken] })}`;

export const unsubscribeUrl = (base: string, tenantId: string, contactId: string, messageId: string | null): string =>
  `${base}/u/${signToken({ kind: "u", parts: [tenantId, contactId, messageId ?? "-"] })}`;

export const viewUrl = (base: string, messageId: string): string =>
  `${base}/w/${signToken({ kind: "w", parts: [messageId] })}`;

/** Double opt-in confirmation link, valid for 7 days. */
export const confirmUrl = (base: string, tenantId: string, contactId: string, listId: string): string =>
  `${base}/c/${signToken({ kind: "k", parts: [tenantId, contactId, listId], exp: Math.floor(Date.now() / 1000) + 7 * 86400 })}`;
