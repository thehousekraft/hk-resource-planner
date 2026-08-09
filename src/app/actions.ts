"use server";

import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { getAllowedTabs, getRole, requireRole, requireTabAccess } from "@/lib/roles";
import type { AppState, Band, Loc, ParentProject, Project, Resource } from "@/lib/types";
import { bkey } from "@/lib/types";
import { todayStr } from "@/lib/calc";

function assertNotPastForNonAdmin(role: string, date: string) {
  if (role !== "admin" && date < todayStr()) {
    throw new Error("Removing a past-dated allocation is locked. Ask an admin to make this change.");
  }
}

const MAX_UPLOAD_BYTES = 7 * 1024 * 1024;
function assertWithinUploadLimit(sizeBytes: number) {
  if (sizeBytes > MAX_UPLOAD_BYTES) {
    throw new Error("File is too large. The upload limit is 7MB.");
  }
}

export async function loadState(): Promise<{
  roster: Resource[];
  parentProjects: ParentProject[];
  projects: Project[];
  bookings: AppState["bookings"];
}> {
  const role = await getRole();
  const allowedTabs = await getAllowedTabs(role);
  const canSeeFinance = allowedTabs.includes("pnl") || allowedTabs.includes("dash") || allowedTabs.includes("roster");
  const supa = getSupabase();
  const [
    { data: resources, error: e1 },
    { data: parentRows, error: e2 },
    { data: projRows, error: e2b },
    { data: matRows, error: e3 },
    { data: areaRows, error: e4 },
    { data: bkRows, error: e5 },
  ] = await Promise.all([
    supa.from("resources").select("*").order("id"),
    supa.from("projects").select("*").order("created_at"),
    supa.from("sub_projects").select("*").order("created_at"),
    supa.from("materials").select("*"),
    supa.from("areas").select("*"),
    supa.from("bookings").select("*"),
  ]);
  const err = e1 || e2 || e2b || e3 || e4 || e5;
  if (err) throw err;

  const roster: Resource[] = (resources || []).map((r) => ({
    id: r.id,
    name: r.name,
    trade: r.trade,
    rate: canSeeFinance ? Number(r.rate) : 0,
    unit: r.unit,
  }));

  const parentProjects: ParentProject[] = (parentRows || []).map((pp) => ({
    id: pp.id,
    name: pp.name,
    customerHoDate: pp.customer_ho_date || null,
  }));

  const projects: Project[] = (projRows || []).map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    revenue: canSeeFinance ? Number(p.revenue) || 0 : 0,
    parentProjectId: p.parent_project_id || null,
    targetMarginPct: canSeeFinance ? (p.target_margin_pct === null ? null : Number(p.target_margin_pct)) : null,
    targetLabourCost: canSeeFinance ? (p.target_labour_cost === null ? null : Number(p.target_labour_cost)) : null,
    materials: [],
    areas: {},
  }));
  const byId: Record<string, Project> = {};
  projects.forEach((p) => (byId[p.id] = p));
  if (canSeeFinance) {
    (matRows || []).forEach((m) => {
      const p = byId[m.project_id];
      if (p) p.materials.push({ id: m.id, item: m.item || "", cost: Number(m.cost) || 0 });
    });
  }
  (areaRows || []).forEach((a) => {
    const p = byId[a.project_id];
    if (!p) return;
    if (!p.areas[a.resource_id]) p.areas[a.resource_id] = [];
    p.areas[a.resource_id].push({ id: a.id, area: a.area_name || "", sqft: Number(a.sqft) || 0 });
  });

  const bookings: AppState["bookings"] = {};
  (bkRows || []).forEach((b) => {
    bookings[bkey(b.date, b.resource_id, b.band as Band)] = {
      proj: b.project_id,
      loc: b.loc as Loc,
      hrs: b.hrs || undefined,
    };
  });

  return { roster, parentProjects, projects, bookings };
}

export async function ensureDefaultProject(pp: ParentProject, p: Project) {
  const supa = getSupabase();
  const { error: ppErr } = await supa.from("projects").insert({ id: pp.id, name: pp.name });
  if (ppErr) throw ppErr;
  const { error } = await supa
    .from("sub_projects")
    .insert({ id: p.id, name: p.name, color: p.color, revenue: 0, parent_project_id: pp.id });
  if (error) throw error;
}

/* parent projects — admin + editor can create/rename; deleting cascades its sub-projects
   (and everything under them), so that stays admin-only, wired from Manage users. */
export async function insertParentProject(pp: { id: string; name: string }) {
  await requireRole("admin", "editor");
  const supa = getSupabase();
  const { error } = await supa.from("projects").insert(pp);
  if (error) throw error;
}
export async function updateParentProjectName(id: string, name: string) {
  await requireRole("admin", "editor");
  const supa = getSupabase();
  const { error } = await supa.from("projects").update({ name }).eq("id", id);
  if (error) throw error;
}
export async function updateCustomerHoDate(id: string, customerHoDate: string | null) {
  await requireTabAccess("pnl");
  const supa = getSupabase();
  const { error } = await supa.from("projects").update({ customer_ho_date: customerHoDate }).eq("id", id);
  if (error) throw error;
}
export async function deleteParentProject(id: string) {
  await requireRole("admin");
  const supa = getSupabase();
  const { error } = await supa.from("projects").delete().eq("id", id);
  if (error) throw error;
}

/* sub-projects — admin + editor can create/rename/delete and book against them;
   only admin can touch revenue and target margin/labour (P&L figures). */
export async function insertProject(p: { id: string; name: string; color: string; revenue: number; parentProjectId: string }) {
  await requireRole("admin", "editor");
  const supa = getSupabase();
  const { error } = await supa
    .from("sub_projects")
    .insert({ id: p.id, name: p.name, color: p.color, revenue: p.revenue, parent_project_id: p.parentProjectId });
  if (error) throw error;
}
export async function updateProjectName(id: string, name: string) {
  await requireRole("admin", "editor");
  const supa = getSupabase();
  const { error } = await supa.from("sub_projects").update({ name }).eq("id", id);
  if (error) throw error;
}
export async function updateProjectRevenue(id: string, revenue: number) {
  await requireTabAccess("pnl");
  const supa = getSupabase();
  const { error } = await supa.from("sub_projects").update({ revenue }).eq("id", id);
  if (error) throw error;
}
export async function updateProjectTargets(id: string, targetMarginPct: number | null, targetLabourCost: number | null) {
  await requireTabAccess("pnl");
  const supa = getSupabase();
  const { error } = await supa
    .from("sub_projects")
    .update({ target_margin_pct: targetMarginPct, target_labour_cost: targetLabourCost })
    .eq("id", id);
  if (error) throw error;
}
export async function deleteProject(id: string) {
  await requireRole("admin", "editor");
  const supa = getSupabase();
  const { error } = await supa.from("sub_projects").delete().eq("id", id);
  if (error) throw error;
}
export async function updateProjectParent(id: string, parentProjectId: string) {
  await requireRole("admin");
  const supa = getSupabase();
  const { error } = await supa.from("sub_projects").update({ parent_project_id: parentProjectId }).eq("id", id);
  if (error) throw error;
}

/* bookings — admin + editor only; viewers are read-only */
export async function upsertBooking(
  date: string,
  resourceId: string,
  band: Band,
  projectId: string,
  loc: Loc,
  hrs?: number,
) {
  await requireRole("admin", "editor");
  const supa = getSupabase();
  const row: Record<string, unknown> = { date, resource_id: resourceId, band, project_id: projectId, loc };
  if (band === "O") row.hrs = hrs;
  const { error } = await supa.from("bookings").upsert(row, { onConflict: "date,resource_id,band" });
  if (error) throw error;
}
export async function deleteBooking(date: string, resourceId: string, band: Band) {
  const role = await requireRole("admin", "editor");
  assertNotPastForNonAdmin(role, date);
  const supa = getSupabase();
  const { error } = await supa
    .from("bookings")
    .delete()
    .eq("date", date)
    .eq("resource_id", resourceId)
    .eq("band", band);
  if (error) throw error;
}
export async function moveBooking(date: string, resourceId: string, band: Band, targetProjectId: string) {
  await requireRole("admin", "editor");
  const supa = getSupabase();
  const { error } = await supa
    .from("bookings")
    .update({ project_id: targetProjectId })
    .eq("date", date)
    .eq("resource_id", resourceId)
    .eq("band", band);
  if (error) throw error;
}

/* materials — admin only (cost data, part of the P&L tab) */
export async function insertMaterial(id: string, projectId: string) {
  await requireTabAccess("pnl");
  const supa = getSupabase();
  const { error } = await supa.from("materials").insert({ id, project_id: projectId, item: "", cost: 0 });
  if (error) throw error;
}
export async function updateMaterial(id: string, patch: { item?: string; cost?: number }) {
  await requireTabAccess("pnl");
  const supa = getSupabase();
  const { error } = await supa.from("materials").update(patch).eq("id", id);
  if (error) throw error;
}
export async function deleteMaterial(id: string) {
  await requireTabAccess("pnl");
  const supa = getSupabase();
  const { error } = await supa.from("materials").delete().eq("id", id);
  if (error) throw error;
}

/* areas — admin only (part of the P&L tab) */
export async function insertArea(id: string, projectId: string, resourceId: string) {
  await requireTabAccess("pnl");
  const supa = getSupabase();
  const { error } = await supa
    .from("areas")
    .insert({ id, project_id: projectId, resource_id: resourceId, area_name: "", sqft: 0 });
  if (error) throw error;
}
export async function updateArea(id: string, patch: { area_name?: string; sqft?: number }) {
  await requireTabAccess("pnl");
  const supa = getSupabase();
  const { error } = await supa.from("areas").update(patch).eq("id", id);
  if (error) throw error;
}
export async function deleteArea(id: string) {
  await requireTabAccess("pnl");
  const supa = getSupabase();
  const { error } = await supa.from("areas").delete().eq("id", id);
  if (error) throw error;
}

/* resources (roster) — admin only (names are visible elsewhere, but rate is wage data) */
export async function insertResource(r: Resource) {
  await requireTabAccess("roster");
  const supa = getSupabase();
  const { error } = await supa.from("resources").insert(r);
  if (error) throw error;
}
export async function insertResourcesBulk(rows: Resource[]) {
  await requireTabAccess("roster");
  if (!rows.length) return;
  const supa = getSupabase();
  const { error } = await supa.from("resources").upsert(rows);
  if (error) throw error;
}
export async function updateResource(id: string, patch: Partial<Resource>) {
  await requireTabAccess("roster");
  const supa = getSupabase();
  const { error } = await supa.from("resources").update(patch).eq("id", id);
  if (error) throw error;
}
export async function deleteResource(id: string) {
  await requireTabAccess("roster");
  const supa = getSupabase();
  const { error } = await supa.from("resources").delete().eq("id", id);
  if (error) throw error;
}
export async function clearAllResources() {
  await requireTabAccess("roster");
  const supa = getSupabase();
  const { error } = await supa.from("resources").delete().neq("id", "");
  if (error) throw error;
}
export async function getRosterDefaults(): Promise<Resource[]> {
  await requireTabAccess("roster");
  const supa = getSupabase();
  const { data, error } = await supa.from("roster_defaults").select("*");
  if (error) throw error;
  return (data || []).map((r) => ({ id: r.id, name: r.name, trade: r.trade, rate: Number(r.rate), unit: r.unit }));
}
export async function resetRosterToDefaults(defaults: Resource[], removeIds: string[]) {
  await requireTabAccess("roster");
  const supa = getSupabase();
  if (removeIds.length) {
    const { error } = await supa.from("resources").delete().in("id", removeIds);
    if (error) throw error;
  }
  const { error } = await supa.from("resources").upsert(defaults);
  if (error) throw error;
}

/* bulk import (restore from JSON backup) — admin only, touches everything including rates */
export async function bulkReplaceState(s: AppState) {
  await requireRole("admin");
  const supa = getSupabase();
  await supa.from("bookings").delete().neq("resource_id", "");
  await supa.from("areas").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supa.from("materials").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supa.from("sub_projects").delete().neq("id", "");
  await supa.from("projects").delete().neq("id", "");
  await supa.from("resources").delete().neq("id", "");

  if (s.roster?.length) {
    const { error } = await supa
      .from("resources")
      .insert(s.roster.map((p) => ({ id: p.id, name: p.name, trade: p.trade, rate: p.rate, unit: p.unit })));
    if (error) throw error;
  }
  if (s.parentProjects?.length) {
    const { error } = await supa
      .from("projects")
      .insert(s.parentProjects.map((pp) => ({ id: pp.id, name: pp.name, customer_ho_date: pp.customerHoDate })));
    if (error) throw error;
  }
  if (s.projects?.length) {
    const { error } = await supa.from("sub_projects").insert(
      s.projects.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        revenue: p.revenue || 0,
        parent_project_id: p.parentProjectId,
        target_margin_pct: p.targetMarginPct,
        target_labour_cost: p.targetLabourCost,
      })),
    );
    if (error) throw error;
  }

  const matRows: { id: string; project_id: string; item: string; cost: number }[] = [];
  const areaRows: { id: string; project_id: string; resource_id: string; area_name: string; sqft: number }[] = [];
  (s.projects || []).forEach((p) => {
    (p.materials || []).forEach((m) =>
      matRows.push({ id: m.id || crypto.randomUUID(), project_id: p.id, item: m.item || "", cost: m.cost || 0 }),
    );
    Object.entries(p.areas || {}).forEach(([resId, list]) =>
      list.forEach((a) =>
        areaRows.push({
          id: a.id || crypto.randomUUID(),
          project_id: p.id,
          resource_id: resId,
          area_name: a.area || "",
          sqft: a.sqft || 0,
        }),
      ),
    );
  });
  if (matRows.length) {
    const { error } = await supa.from("materials").insert(matRows);
    if (error) throw error;
  }
  if (areaRows.length) {
    const { error } = await supa.from("areas").insert(areaRows);
    if (error) throw error;
  }

  const bkRows = Object.entries(s.bookings || {}).map(([k, b]) => {
    const [date, resId, band] = k.split("|");
    const row: Record<string, unknown> = { date, resource_id: resId, band, project_id: b.proj, loc: b.loc };
    if (band === "O") row.hrs = b.hrs;
    return row;
  });
  if (bkRows.length) {
    const { error } = await supa.from("bookings").insert(bkRows);
    if (error) throw error;
  }
}

/* invoices — admin only (attached to material estimates, part of the P&L tab) */
export interface InvoiceRow {
  id: string;
  fileName: string;
  uploadedAt: string;
  url: string;
}
export async function listInvoices(projectId: string): Promise<InvoiceRow[]> {
  await requireTabAccess("pnl");
  const supa = getSupabase();
  const { data, error } = await supa
    .from("invoices")
    .select("*")
    .eq("project_id", projectId)
    .order("uploaded_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id,
    fileName: r.file_name,
    uploadedAt: r.uploaded_at,
    url: supa.storage.from("invoices").getPublicUrl(r.storage_path).data.publicUrl,
  }));
}
export async function createInvoiceUploadUrl(projectId: string, fileName: string, fileSize: number) {
  await requireTabAccess("pnl");
  assertWithinUploadLimit(fileSize);
  const supa = getSupabase();
  const path = `${projectId}/${Date.now()}_${fileName}`;
  const { data, error } = await supa.storage.from("invoices").createSignedUploadUrl(path);
  if (error) throw error;
  return { signedUrl: data.signedUrl, path };
}
export async function finalizeInvoiceUpload(projectId: string, path: string, fileName: string) {
  await requireTabAccess("pnl");
  const supa = getSupabase();
  const { error: insErr } = await supa.from("invoices").insert({ project_id: projectId, file_name: fileName, storage_path: path });
  if (insErr) throw insErr;
}
export async function deleteInvoice(id: string) {
  await requireRole("admin");
  const supa = getSupabase();
  const { data: row, error: readErr } = await supa.from("invoices").select("storage_path").eq("id", id).single();
  if (readErr) throw readErr;
  await supa.storage.from("invoices").remove([row.storage_path]);
  const { error } = await supa.from("invoices").delete().eq("id", id);
  if (error) throw error;
}

/* scope drawings — one per project, part of the P&L tab's Day-rate labour card.
   Admin can upload/replace anytime. Everyone else gets exactly one upload; after
   that the slot is locked until an admin approves a re-upload request. */
export interface ScopeDrawingRow {
  fileName: string;
  url: string;
  uploadedAt: string;
}
export type ReuploadLockStatus = "none" | "pending" | "approved";

export async function getScopeDrawing(projectId: string): Promise<ScopeDrawingRow | null> {
  await requireTabAccess("pnl");
  const supa = getSupabase();
  const { data, error } = await supa.from("scope_drawings").select("*").eq("project_id", projectId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    fileName: data.file_name,
    uploadedAt: data.uploaded_at,
    url: supa.storage.from("scope-drawings").getPublicUrl(data.storage_path).data.publicUrl,
  };
}

export async function getScopeReuploadStatus(projectId: string): Promise<ReuploadLockStatus> {
  await requireTabAccess("pnl");
  const supa = getSupabase();
  const { data, error } = await supa
    .from("scope_reupload_requests")
    .select("status")
    .eq("project_id", projectId)
    .in("status", ["pending", "approved"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data?.status as "pending" | "approved" | undefined) || "none";
}

/* Resolves whether `role` may (re)upload a scope drawing for this project, and returns
   whatever bookkeeping the eventual write will need. Throws if a non-admin is locked out. */
async function resolveScopeUploadAuthorization(supa: ReturnType<typeof getSupabase>, projectId: string, role: string) {
  const { data: existing, error: existErr } = await supa
    .from("scope_drawings")
    .select("id, storage_path")
    .eq("project_id", projectId)
    .maybeSingle();
  if (existErr) throw existErr;

  let approvedRequestId: string | null = null;
  if (existing && role !== "admin") {
    const { data: approved, error: reqErr } = await supa
      .from("scope_reupload_requests")
      .select("id")
      .eq("project_id", projectId)
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (reqErr) throw reqErr;
    if (!approved) throw new Error("A scope drawing is already uploaded. Request re-upload approval from admin first.");
    approvedRequestId = approved.id;
  }
  return { existing, approvedRequestId };
}

export async function deleteScopeDrawing(projectId: string) {
  await requireRole("admin");
  const supa = getSupabase();
  const { data: row, error: readErr } = await supa
    .from("scope_drawings")
    .select("storage_path")
    .eq("project_id", projectId)
    .single();
  if (readErr) throw readErr;
  await supa.storage.from("scope-drawings").remove([row.storage_path]);
  const { error } = await supa.from("scope_drawings").delete().eq("project_id", projectId);
  if (error) throw error;
}

/* Vercel's serverless functions hard-cap request bodies at ~4.5MB regardless of any
   Next.js config, so files anywhere near our 7MB limit must go straight from the
   browser to Supabase Storage via a signed URL — never through our own server. */
export async function createScopeUploadUrl(projectId: string, fileName: string, fileSize: number) {
  const role = await requireTabAccess("pnl");
  assertWithinUploadLimit(fileSize);
  const supa = getSupabase();
  await resolveScopeUploadAuthorization(supa, projectId, role);
  const path = `${projectId}/${Date.now()}_${fileName}`;
  const { data, error } = await supa.storage.from("scope-drawings").createSignedUploadUrl(path);
  if (error) throw error;
  return { signedUrl: data.signedUrl, path };
}

export async function finalizeScopeUpload(projectId: string, path: string, fileName: string) {
  const role = await requireTabAccess("pnl");
  const supa = getSupabase();
  const { userId } = await auth();
  const { existing, approvedRequestId } = await resolveScopeUploadAuthorization(supa, projectId, role);

  if (existing) {
    const { error: updErr } = await supa
      .from("scope_drawings")
      .update({ file_name: fileName, storage_path: path, uploaded_by: userId, uploaded_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (updErr) throw updErr;
    await supa.storage.from("scope-drawings").remove([existing.storage_path]);
  } else {
    const { error: insErr } = await supa
      .from("scope_drawings")
      .insert({ project_id: projectId, file_name: fileName, storage_path: path, uploaded_by: userId });
    if (insErr) throw insErr;
  }

  if (approvedRequestId) {
    await supa.from("scope_reupload_requests").update({ status: "fulfilled" }).eq("id", approvedRequestId);
  }
}

export async function requestScopeReupload(projectId: string, justification: string) {
  await requireTabAccess("pnl");
  const trimmed = justification.trim();
  if (!trimmed) throw new Error("Please provide a justification for the re-upload.");
  const supa = getSupabase();
  const { userId } = await auth();
  const { error } = await supa
    .from("scope_reupload_requests")
    .insert({ project_id: projectId, justification: trimmed, requested_by: userId });
  if (error) throw error;
}
