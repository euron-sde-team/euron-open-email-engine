// Deterministic test configuration. Runs before any test file imports
// src/config, so these values are what the app sees. Never real secrets.
process.env.TZ = "UTC";
process.env.NODE_ENV = "test";
process.env.AWS_SES_FROM_EMAIL ||= "noreply@example.com";
process.env.APP_PUBLIC_URL = "http://localhost:5126";
// A tenant with 20 sends is enough to trip a reputation tier in the integration tests.
process.env.EMAIL_REPUTATION_MIN_SENDS = "20";
process.env.EMAIL_TRACKING_CUSTOM_DOMAINS = "false";
