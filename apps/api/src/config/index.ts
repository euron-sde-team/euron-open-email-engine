import path from "path";
import dotenv from "dotenv";

dotenv.config();

const DEV_JWT_SECRET = "dev-only-jwt-secret-change-me";

const config = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  isProduction: process.env.NODE_ENV === "production",
  PORT: process.env.PORT || "5126",

  JWT_SECRET: process.env.JWT_SECRET || DEV_JWT_SECRET,
  // Bearer tokens are not revocable (see docs/architecture/security.md), so keep
  // them short. Users sign in again after this.
  JWT_EXPIRY: process.env.JWT_EXPIRY || "12h",

  // Browser origins allowed to call the API (comma separated). Defaults to the
  // two SPAs. "*" is refused because responses carry credentials.
  CORS_ORIGINS: (
    process.env.CORS_ORIGINS ||
    `${process.env.EMAIL_APP_URL || "http://localhost:3650"},${process.env.OPERATOR_APP_URL || "http://localhost:3660"}`
  )
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter((o) => o && o !== "*"),
  // Number of reverse proxies in front of the API (ALB = 1, CloudFront + ALB =
  // 2). Decides which X-Forwarded-For entry is the client IP for rate limits.
  TRUST_PROXY: Number(process.env.TRUST_PROXY || "1"),

  PG_DATABASE_HOST: process.env.PG_DATABASE_HOST ?? "localhost",
  PG_DATABASE_USER: process.env.PG_DATABASE_USER ?? "postgres",
  PG_DATABASE_PASSWORD: process.env.PG_DATABASE_PASSWORD ?? "postgres",
  PG_DATABASE_PORT: process.env.PG_DATABASE_PORT ?? "5432",
  PG_DATABASE: process.env.PG_DATABASE ?? "mail",
  PG_POOL_MAX: process.env.PG_POOL_MAX,
  PG_POOL_MIN: process.env.PG_POOL_MIN,
  PG_CONNECTION_TIMEOUT: process.env.PG_CONNECTION_TIMEOUT,
  PG_IDLE_TIMEOUT: process.env.PG_IDLE_TIMEOUT,

  AWS_REGION: process.env.AWS_REGION || "us-east-1",
  // Bucket for uploaded files (CSV imports). Blank = local disk.
  // Credentials come from AWS_S3_ACCESS_KEY/SECRET_KEY when set, else the
  // default AWS chain (the ECS task role in production).
  AWS_S3_BUCKET: process.env.AWS_S3_BUCKET ?? "",
  AWS_S3_ACCESS_KEY: process.env.AWS_S3_ACCESS_KEY ?? "",
  AWS_S3_SECRET_KEY: process.env.AWS_S3_SECRET_KEY ?? "",
  // Override endpoint for every AWS client (a local emulator such as Floci).
  AWS_ENDPOINT_URL: process.env.AWS_ENDPOINT_URL ?? "",

  AWS_SES_REGION: process.env.AWS_SES_REGION || process.env.AWS_REGION || "us-east-1",
  AWS_SES_ACCESS_KEY: process.env.AWS_SES_ACCESS_KEY ?? "",
  AWS_SES_SECRET_KEY: process.env.AWS_SES_SECRET_KEY ?? "",
  AWS_SES_FROM_EMAIL: process.env.AWS_SES_FROM_EMAIL ?? "",
  AWS_SES_FROM_NAME: process.env.AWS_SES_FROM_NAME || "Open Email Engine",

  // The tenant app (SPA) base URL, where the browser lands. Used for the sign-in, invite
  // and password-reset links the backend builds. Bare origin, no trailing slash.
  // BRAND_NAME is the display copy of platform mail, sent from AWS_SES_FROM_EMAIL.
  EMAIL_APP_URL: process.env.EMAIL_APP_URL || "http://localhost:3650",
  // The operator console (platform admin) SPA base URL, used for operator
  // password-reset links. Bare origin, no trailing slash.
  OPERATOR_APP_URL: process.env.OPERATOR_APP_URL || "http://localhost:3660",
  BRAND_NAME: process.env.BRAND_NAME || "Open Email Engine",

  // Per-tenant sending-domain (BYOSD) event pipeline. Empty until the SNS
  // topic + SQS queue exist (Terraform email module, or scripts/ses-infra-setup.ts); the events consumer
  // stays idle while unset, and sends still work via the resolver/fallback.
  SES_EVENTS_SNS_TOPIC_ARN: process.env.SES_EVENTS_SNS_TOPIC_ARN ?? "",
  SES_EVENTS_QUEUE_URL: process.env.SES_EVENTS_QUEUE_URL ?? "",
  // Dead-letter queue of the events queue; the operator console peeks at it.
  SES_EVENTS_DLQ_URL: process.env.SES_EVENTS_DLQ_URL ?? "",
  // Redis (resolver cache + send rate limiting). Empty disables Redis and the
  // app fails open (in-process compute, no rate cap). Not used under tests.
  REDIS_URL: process.env.REDIS_URL ?? "",
  // HTTP rate limiting (auth brute-force, public-endpoint abuse).
  // On by default; set to "false" to disable every limiter (e.g. load testing).
  // Redis-backed when REDIS_URL is set (shared across instances), else an
  // in-memory per-instance window. Always disabled under tests.
  RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED !== "false",
  // Per-tenant base send rate (sends/second). The reputation category multiplier
  // scales this, and a tenant can override it via tenants.config.emailTps.
  EMAIL_DEFAULT_TENANT_TPS: Number(process.env.EMAIL_DEFAULT_TENANT_TPS ?? "5"),
  // Account-wide ceiling across all tenants (sends/second).
  EMAIL_ACCOUNT_TPS: Number(process.env.EMAIL_ACCOUNT_TPS ?? "14"),

  // Public origin of this API. Serves the /t /u /w /f /c links (mounted at the API root)
  // and is the base of every tracked link, unsubscribe link and form URL.
  APP_PUBLIC_URL: process.env.APP_PUBLIC_URL || "http://localhost:5126",

  // Link signing. Unsubscribe, view and confirmation links use one secret; the open pixel and
  // click redirect use another, so rotating one never breaks the other. Both default to
  // JWT_SECRET.
  EMAIL_UNSUBSCRIBE_SIGNING_SECRET:
    process.env.EMAIL_UNSUBSCRIBE_SIGNING_SECRET || process.env.JWT_SECRET || DEV_JWT_SECRET,
  EMAIL_TRACKING_SIGNING_SECRET:
    process.env.EMAIL_TRACKING_SIGNING_SECRET || process.env.JWT_SECRET || DEV_JWT_SECRET,

  // "simulated" (ADR 0006): no AWS call is made for domains or sends. Always simulated under
  // tests. When unset, simulated if no SES sender is configured, else "aws". Production must
  // be "aws".
  EMAIL_SES_MODE: (process.env.EMAIL_SES_MODE || "") as "" | "aws" | "simulated",
  // Simulated domains verify on their own this many minutes after creation (0 = only on
  // "Check now"), so a demo works offline without DNS.
  EMAIL_DOMAIN_SIMULATE_VERIFY_MINUTES: Number(process.env.EMAIL_DOMAIN_SIMULATE_VERIFY_MINUTES ?? "2"),
  // CNAME target of every tenant's track.<domain> record (the platform host that serves /t/*).
  EMAIL_TRACKING_HOST: process.env.EMAIL_TRACKING_HOST || "track.mail-engine.example",
  // Links use the platform host (APP_PUBLIC_URL) because TLS certificates cover only
  // platform hosts. Set true to serve links from a tenant's verified track.<domain> over
  // https once certificates exist for those names.
  EMAIL_TRACKING_CUSTOM_DOMAINS: process.env.EMAIL_TRACKING_CUSTOM_DOMAINS === "true",
  // Sends in the rolling 14 days before reputation tiers apply.
  EMAIL_REPUTATION_MIN_SENDS: Number(process.env.EMAIL_REPUTATION_MIN_SENDS ?? "100"),
  // Reputation tier thresholds, as fractions. The THROTTLED tier sits halfway between.
  EMAIL_REPUTATION_BOUNCE_WARN: Number(process.env.EMAIL_REPUTATION_BOUNCE_WARN ?? "0.03"),
  EMAIL_REPUTATION_BOUNCE_PAUSE: Number(process.env.EMAIL_REPUTATION_BOUNCE_PAUSE ?? "0.05"),
  EMAIL_REPUTATION_COMPLAINT_WARN: Number(process.env.EMAIL_REPUTATION_COMPLAINT_WARN ?? "0.0005"),
  EMAIL_REPUTATION_COMPLAINT_PAUSE: Number(process.env.EMAIL_REPUTATION_COMPLAINT_PAUSE ?? "0.001"),
  // Rows a single campaign recipient claim takes.
  EMAIL_SEND_BATCH: Number(process.env.EMAIL_SEND_BATCH ?? "50"),


  // Local-disk storage root, used when AWS_S3_BUCKET is blank.
  LOCAL_STORAGE_DIR: path.resolve(process.env.LOCAL_STORAGE_DIR || path.join(process.cwd(), ".local-storage")),
};

/**
 * Production refuses to start on development defaults: a guessable JWT secret
 * lets anyone mint tokens, and a guessable credentials key decrypts every
 * tenant's provider keys.
 */
export function assertProductionConfig(c: typeof config = config): void {
  if (!c.isProduction) return;
  const problems: string[] = [];
  if (c.JWT_SECRET === DEV_JWT_SECRET || c.JWT_SECRET.length < 32) {
    problems.push("JWT_SECRET must be set to a random value of at least 32 characters");
  }
  if (c.CORS_ORIGINS.length === 0) problems.push("CORS_ORIGINS must list the app origins");
  for (const k of ["EMAIL_UNSUBSCRIBE_SIGNING_SECRET", "EMAIL_TRACKING_SIGNING_SECRET"] as const) {
    if (c[k] === DEV_JWT_SECRET || c[k].length < 32) {
      problems.push(`${k} (or JWT_SECRET) must be a random value of at least 32 characters`);
    }
  }
  if (c.EMAIL_SES_MODE !== "aws") {
    problems.push("EMAIL_SES_MODE must be set to aws: production sends through SES and never guesses the mode");
  }
  if (!/^https:\/\//.test(c.APP_PUBLIC_URL) || /localhost|127\.0\.0\.1/.test(c.APP_PUBLIC_URL)) {
    problems.push("APP_PUBLIC_URL must be the public https origin that serves /t, /u, /w, /f and /c links");
  }
  if (problems.length) {
    throw new Error(`Refusing to start in production:\n  - ${problems.join("\n  - ")}`);
  }
}

export default config;
