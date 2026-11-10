// Product brand for the default (non white-labelled) experience. Tenants can set
// their own accent colour from Settings; everything else that says the product
// name reads it from here, so a fork rebrands in one file.

export const BRAND = {
  /** Product name shown in the UI. */
  name: "Open Mail",
  /** Lowercase wordmark pieces: "open" + accent "mail." */
  wordmark: { lead: "open", accent: "mail." },
  /** One-letter mark used in the square logo tile. */
  initial: "O",
  /** Default accent (rose, hue 334); 7.0:1 against white. */
  defaultColor: "#ab1757",
  /** One line under the wordmark. */
  tagline: "Email engine",
  poweredBy: "Powered by Open Mail",
} as const;
