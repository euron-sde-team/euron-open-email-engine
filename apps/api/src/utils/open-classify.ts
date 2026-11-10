// Decides whether an open or click came from a person or from a mail client acting on their
// behalf (Apple Mail Privacy Protection, image proxies, link scanners). Machine hits are
// still recorded, flagged, and kept out of the "last opened" and click counters.

export type UaClass = "apple-mpp" | "google-proxy" | "yahoo-proxy" | "prefetch" | "scanner" | "bot" | "browser" | "unknown";

export interface HitInfo {
  ip?: string | null;
  userAgent?: string | null;
  /** Value of Sec-Purpose or X-Moz or Purpose headers, if any. */
  purpose?: string | null;
  /** Milliseconds between the send and this hit. */
  sinceSentMs?: number | null;
  kind: "open" | "click";
}

const PREFETCH_WINDOW_MS = 3_000;

export const classifyHit = (hit: HitInfo): { machine: boolean; uaClass: UaClass } => {
  const ua = (hit.userAgent ?? "").toLowerCase();
  if (/prefetch|preview/i.test(hit.purpose ?? "")) return { machine: true, uaClass: "prefetch" };
  if (ua.includes("googleimageproxy") || ua.includes("ggpht.com")) return { machine: true, uaClass: "google-proxy" };
  if (ua.includes("yahoomailproxy") || ua.includes("yahoo! slurp")) return { machine: true, uaClass: "yahoo-proxy" };
  if (hit.kind === "open" && /^17\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hit.ip ?? "")) {
    return { machine: true, uaClass: "apple-mpp" };
  }
  if (/barracuda|proofpoint|mimecast|safelinks|symantec|trendmicro|ironport|urlscan|microsoft office|skypeuripreview/.test(ua)) {
    return { machine: true, uaClass: "scanner" };
  }
  if (/bot|crawler|spider|curl\/|wget|python-requests|go-http-client|headless/.test(ua)) {
    return { machine: true, uaClass: "bot" };
  }
  if (hit.sinceSentMs !== null && hit.sinceSentMs !== undefined && hit.sinceSentMs >= 0 && hit.sinceSentMs < PREFETCH_WINDOW_MS) {
    return { machine: true, uaClass: "prefetch" };
  }
  if (!ua) return { machine: false, uaClass: "unknown" };
  return { machine: false, uaClass: "browser" };
};
