/**
 * Collapse a host/subdomain to its registrable root so it matches backlink_db
 * (which stores roots). Examples:
 *   svnesterov.blogspot.com → blogspot.com
 *   sub.example.co.uk       → example.co.uk   (keep 3 labels for 2-part ccTLD)
 *
 * Same logic is duplicated inline in a couple of older routes; new code should
 * import this helper.
 */

const MULTI_SLD = new Set([
  "co", "com", "net", "org", "gov", "edu", "ac", "or", "ne", "go", "mil",
]);

export function rootDomain(host: string): string {
  const h = String(host || "")
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
  const parts = h.split(".").filter(Boolean);
  if (parts.length <= 2) return h;
  const last = parts[parts.length - 1];
  const sld = parts[parts.length - 2];
  if (last.length === 2 && MULTI_SLD.has(sld)) return parts.slice(-3).join(".");
  return parts.slice(-2).join(".");
}
