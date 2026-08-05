import { auth, currentUser } from "@clerk/nextjs/server";
import { getSupabase } from "./supabase";
import type { Role } from "./roleTypes";
import { ALL_TAB_KEYS, DEFAULT_ALLOWED_TABS, type TabKey } from "./tabs";

export type { Role } from "./roleTypes";
export { COMPANY_DOMAIN, isCompanyEmail } from "./roleTypes";

const ADMIN_EMAIL = (process.env.INITIAL_ADMIN_EMAIL || "").toLowerCase();

/**
 * Looks up (and lazily creates) the caller's profile row. New profiles get
 * their role from the accepted invitation's metadata (set by an admin when
 * they sent the invite); INITIAL_ADMIN_EMAIL is a one-time bootstrap fallback
 * for the very first admin account; anyone else defaults to viewer.
 */
export async function ensureProfile(): Promise<{ userId: string; role: Role }> {
  const { userId } = await auth();
  if (!userId) throw new Error("Not signed in");

  const supa = getSupabase();
  const { data: existing, error: readErr } = await supa
    .from("profiles")
    .select("role")
    .eq("clerk_user_id", userId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (existing) return { userId, role: existing.role as Role };

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress?.toLowerCase() || "";
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || email;
  const invitedRole = user?.publicMetadata?.role as Role | undefined;
  const role: Role = invitedRole || (email && email === ADMIN_EMAIL ? "admin" : "viewer");

  const { error: insErr } = await supa.from("profiles").insert({ clerk_user_id: userId, email, name, role });
  if (insErr) throw insErr;
  return { userId, role };
}

export async function getRole(): Promise<Role> {
  const { role } = await ensureProfile();
  return role;
}

export async function requireRole(...allowed: Role[]) {
  const role = await getRole();
  if (!allowed.includes(role)) {
    throw new Error("Forbidden: insufficient permissions");
  }
  return role;
}

/** Admin always has every tab; editor/viewer are governed by the configurable role_permissions table. */
export async function getAllowedTabs(role: Role): Promise<TabKey[]> {
  if (role === "admin") return ALL_TAB_KEYS;
  const supa = getSupabase();
  const { data, error } = await supa.from("role_permissions").select("allowed_tabs").eq("role", role).maybeSingle();
  if (error) throw error;
  return (data?.allowed_tabs as TabKey[] | undefined) || DEFAULT_ALLOWED_TABS[role] || [];
}

/** Like requireRole, but for actions whose access should follow the configurable tab permissions
 *  rather than a hardcoded role list (e.g. roster edits gated behind the "roster" tab). Admin always passes. */
export async function requireTabAccess(tab: TabKey) {
  const role = await getRole();
  if (role === "admin") return role;
  const tabs = await getAllowedTabs(role);
  if (!tabs.includes(tab)) {
    throw new Error("Forbidden: your role doesn't have access to this section");
  }
  return role;
}
