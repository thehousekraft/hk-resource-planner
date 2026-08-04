import { auth, currentUser } from "@clerk/nextjs/server";
import { getSupabase } from "./supabase";

export type Role = "admin" | "editor" | "viewer";

const ADMIN_EMAIL = (process.env.INITIAL_ADMIN_EMAIL || "").toLowerCase();

/**
 * Looks up (and lazily creates) the caller's profile row. The very first
 * sign-in from INITIAL_ADMIN_EMAIL becomes admin; everyone else starts as
 * viewer and an existing admin has to promote them.
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
  const role: Role = email && email === ADMIN_EMAIL ? "admin" : "viewer";

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
