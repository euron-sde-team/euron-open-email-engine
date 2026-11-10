import crypto from "crypto";
import config from "../config";

// Signed, stateless tokens for every public link an email carries: open pixel, click
// redirect, unsubscribe, view in browser, double opt-in confirmation. HMAC-SHA256 over the
// payload, compared in constant time. A token carries only ids; the destination of a click
// is looked up in the database, never read from the token.

export type TokenKind = "o" | "c" | "u" | "w" | "k";

export interface TokenPayload {
  kind: TokenKind;
  parts: string[];
  /** Unix seconds; absent means the token does not expire. */
  exp?: number;
}

const keyFor = (secret: string): Buffer =>
  crypto.createHash("sha256").update(`email-tokens:${secret}`).digest();

const SEP = "|";

const mac = (body: string, secret: string): string =>
  crypto.createHmac("sha256", keyFor(secret)).update(body).digest("base64url");

const secretFor = (kind: TokenKind, override?: string): string =>
  override ?? (kind === "o" || kind === "c" ? config.EMAIL_TRACKING_SIGNING_SECRET : config.EMAIL_UNSUBSCRIBE_SIGNING_SECRET);

/** Ids are ULIDs and link tokens are base64url: no separator can occur, but refuse it anyway. */
const assertPart = (p: string): void => {
  if (!p || p.includes(SEP) || p.includes("~")) throw new Error("invalid token part");
};

export const signToken = (payload: TokenPayload, secret?: string): string => {
  payload.parts.forEach(assertPart);
  const raw = [payload.kind, payload.exp ?? "", ...payload.parts].join(SEP);
  const body = Buffer.from(raw).toString("base64url");
  return `${body}~${mac(body, secretFor(payload.kind, secret))}`;
};

export const verifyToken = (
  token: string,
  expectedKind: TokenKind,
  opts: { secret?: string; now?: number } = {}
): TokenPayload | null => {
  if (typeof token !== "string" || token.length > 600) return null;
  const [body, sig, extra] = token.split("~");
  if (!body || !sig || extra !== undefined) return null;
  const expected = Buffer.from(mac(body, secretFor(expectedKind, opts.secret)));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  let raw: string;
  try {
    raw = Buffer.from(body, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const [kind, exp, ...parts] = raw.split(SEP);
  if (kind !== expectedKind || parts.length === 0) return null;
  const expNum = exp === "" ? undefined : Number(exp);
  if (expNum !== undefined) {
    if (!Number.isFinite(expNum)) return null;
    if (expNum * 1000 < (opts.now ?? Date.now())) return null;
  }
  return { kind: kind as TokenKind, parts, exp: expNum };
};

/** Hashes an IP with a keyed hash so raw addresses are never stored. */
export const hashIp = (ip: string | undefined | null, secret?: string): string | null =>
  ip ? crypto.createHmac("sha256", keyFor(secret ?? config.EMAIL_TRACKING_SIGNING_SECRET)).update(`ip:${ip}`).digest("hex").slice(0, 32) : null;

export const randomLinkToken = (): string => crypto.randomBytes(9).toString("base64url");
