// Product brand for the operator console. Everything that says the product
// name reads it from here, so a fork rebrands in one file.

export const BRAND = {
  /** Product name shown in the UI. */
  name: "Euron Open Email Engine",
  /** One-letter mark used in the square logo tile. */
  initial: "E",
  poweredBy: "Euron Open Email Engine, operator plane",
} as const;
