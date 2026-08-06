"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { COMPANY_DOMAIN, isCompanyEmail, requireRole, type Role } from "@/lib/roles";
import { DEFAULT_ALLOWED_TABS, type ConfigurableRole, type TabKey } from "@/lib/tabs";

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

/* RBAC tab permissions — admin always has every tab (not stored/editable);
   editor/viewer visibility into each page is configured here. */
export async function getRolePermissionsMatrix(): Promise<Record<ConfigurableRole, TabKey[]>> {
  await requireRole("admin");
  const supa = getSupabase();
  const { data, error } = await supa.from("role_permissions").select("*");
  if (error) throw error;
  const result: Record<ConfigurableRole, TabKey[]> = {
    editor: DEFAULT_ALLOWED_TABS.editor,
    viewer: DEFAULT_ALLOWED_TABS.viewer,
  };
  (data || []).forEach((row) => {
    if (row.role === "editor" || row.role === "viewer") {
      result[row.role as ConfigurableRole] = (row.allowed_tabs as TabKey[]) || [];
    }
  });
  return result;
}

export async function updateRolePermissions(role: ConfigurableRole, allowedTabs: TabKey[]) {
  await requireRole("admin");
  const supa = getSupabase();
  const { error } = await supa
    .from("role_permissions")
    .upsert({ role, allowed_tabs: allowedTabs.filter((t) => t !== "users") }, { onConflict: "role" });
  if (error) throw error;
}

/* scope-drawing re-upload requests — admin reviews and approves/rejects here. */
export interface ReuploadRequestRow {
  id: string;
  projectId: string;
  projectName: string;
  requestedByEmail: string;
  justification: string;
  createdAt: string;
}

export async function listPendingReuploadRequests(): Promise<ReuploadRequestRow[]> {
  await requireRole("admin");
  const supa = getSupabase();
  const { data, error } = await supa
    .from("scope_reupload_requests")
    .select("id, project_id, justification, created_at, requested_by, projects(name)")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw error;

  const requestedIds = [...new Set((data || []).map((r) => r.requested_by).filter(Boolean))];
  const emailByUserId: Record<string, string> = {};
  if (requestedIds.length) {
    const { data: profs } = await supa.from("profiles").select("clerk_user_id,email").in("clerk_user_id", requestedIds);
    (profs || []).forEach((p) => (emailByUserId[p.clerk_user_id] = p.email || ""));
  }

  return (data || []).map((r) => ({
    id: r.id,
    projectId: r.project_id,
    projectName: (r.projects as { name?: string } | null)?.name || r.project_id,
    requestedByEmail: emailByUserId[r.requested_by as string] || "—",
    justification: r.justification,
    createdAt: r.created_at,
  }));
}

export async function approveReuploadRequest(id: string) {
  await requireRole("admin");
  const { userId } = await auth();
  const supa = getSupabase();
  const { error } = await supa
    .from("scope_reupload_requests")
    .update({ status: "approved", reviewed_by: userId, reviewed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function rejectReuploadRequest(id: string) {
  await requireRole("admin");
  const { userId } = await auth();
  const supa = getSupabase();
  const { error } = await supa
    .from("scope_reupload_requests")
    .update({ status: "rejected", reviewed_by: userId, reviewed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
