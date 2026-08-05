export type Role = "admin" | "editor" | "viewer";
export const COMPANY_DOMAIN = "@thehousekraft.com";

export function isCompanyEmail(email: string) {
  return email.trim().toLowerCase().endsWith(COMPANY_DOMAIN);
}
