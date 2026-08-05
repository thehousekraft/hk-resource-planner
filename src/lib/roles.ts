import { auth, currentUser } from "@clerk/nextjs/server";
import { getSupabase } from "./supabase";
import type { Role } from "./roleTypes";

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
