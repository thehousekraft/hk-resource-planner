"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { COMPANY_DOMAIN, isCompanyEmail, requireRole, type Role } from "@/lib/roles";

export interface UserRow {
  clerkUserId: string;
  email: string;
  name: string;
  role: Role;
  createdAt: string;
}
export interface PendingInviteRow {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
}

export async function listUsers(): Promise<UserRow[]> {
  await requireRole("admin");
  const supa = getSupabase();
  const { data, error } = await supa.from("profiles").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map((r) => ({
    clerkUserId: r.clerk_user_id,
    email: r.email || "",
    name: r.name || "",
    role: r.role as Role,
    createdAt: r.created_at,
  }));
}

export async function listPendingInvitations(): Promise<PendingInviteRow[]> {
  await requireRole("admin");
  const client = await clerkClient();
  const { data } = await client.invitations.getInvitationList({ status: "pending", limit: 100 });
  return data.map((inv) => ({
    id: inv.id,
    email: inv.emailAddress,
    role: ((inv.publicMetadata as Record<string, unknown> | null)?.role as Role) || "viewer",
    createdAt: new Date(inv.createdAt).toISOString(),
  }));
}

export async function inviteUser(email: string, role: Role) {
  await requireRole("admin");
  const trimmed = email.trim().toLowerCase();
  if (!isCompanyEmail(trimmed)) {
    throw new Error(`Only ${COMPANY_DOMAIN} email addresses can be invited.`);
  }
  const client = await clerkClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://hk-resource-planner.vercel.app";
  await client.invitations.createInvitation({
    emailAddress: trimmed,
    publicMetadata: { role },
    redirectUrl: `${appUrl}/sign-up`,
  });
}

export async function revokeInvitation(invitationId: string) {
  await requireRole("admin");
  const client = await clerkClient();
  await client.invitations.revokeInvitation(invitationId);
}

export async function updateUserRole(clerkUserId: string, role: Role) {
  await requireRole("admin");
  const { userId } = await auth();
  if (userId === clerkUserId) {
    throw new Error("You can't change your own role — have another admin do it.");
  }
  const supa = getSupabase();
  const { error } = await supa.from("profiles").update({ role }).eq("clerk_user_id", clerkUserId);
  if (error) throw error;
}
