/** A redirect target must be an absolute http(s) URL without credentials. Nothing else is ever followed. */
export const clickUrlIsSafe = (raw: string): boolean => {
  if (raw.length > 2048) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.username || u.password) return false;
  return true;
};
