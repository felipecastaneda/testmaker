/**
 * How students identify themselves when they take an online exam (step 4).
 *   name_and_id  typed name + student ID (no account)
 *   google       sign in with a Google account (optionally limited to school domains)
 */

export type StudentIdentity = "name_and_id" | "google";

export const IDENTITY_LABELS: Record<StudentIdentity, string> = {
  name_and_id: "Name and student ID",
  google: "Google account",
};

const DOMAIN = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** "school.edu, @Students.School.edu" → ["school.edu", "students.school.edu"]; invalid entries are reported. */
export function parseDomains(text: string): { domains: string[]; invalid: string[] } {
  const domains: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const d = raw.trim().toLowerCase().replace(/^@/, "");
    if (!d) continue;
    if (!DOMAIN.test(d)) invalid.push(raw.trim());
    else if (!domains.includes(d)) domains.push(d);
  }
  return { domains, invalid };
}

/** May this verified email join? No domains = any account; subdomains of a listed domain count. */
export function emailAllowed(email: string, domains: string[]): boolean {
  if (!domains.length) return true;
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const host = email.slice(at + 1).toLowerCase();
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/** "Sign in with your school.edu account" / "…school.edu or college.edu account". */
export function domainHint(domains: string[]): string {
  if (!domains.length) return "";
  return domains.length === 1 ? domains[0] : `${domains.slice(0, -1).join(", ")} or ${domains[domains.length - 1]}`;
}
