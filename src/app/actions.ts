"use server";

import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { getAllowedTabs, getRole, requireRole, requireTabAccess } from "@/lib/roles";
import type { AppState, Band, Loc, Project, Resource } from "@/lib/types";
import { bkey } from "@/lib/types";
import { todayStr } from "@/lib/calc";

function assertNotPastForNonAdmin(role: string, date: string) {
  if (role !== "admin" && date < todayStr()) {
    throw new Error("Removing a past-dated allocation is locked. Ask an admin to make this change.");
  }
}

const MAX_UPLOAD_BYTES = 7 * 1024 * 1024;
function assertWithinUploadLimit(buffer: Buffer) {
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error("File is too large. The upload limit is 7MB.");
  }
}

export async function loadState(): Promise<{
  roster: Resource[];
  projects: Project[];
  bookings: AppState["bookings"];
}> {
  const role = await getRole();
  const allowedTabs = await getAllowedTabs(role);
  const canSeeFinance = allowedTabs.includes("pnl") || allowedTabs.includes("dash") || allowedTabs.includes("roster");
  const supa = getSupabase();
  const [
    { data: resources, error: e1 },
    { data: projRows, error: e2 },
    { data: matRows, error: e3 },
    { data: areaRows, error: e4 },
    { data: bkRows, error: e5 },
  ] = await Promise.all([
    supa.from("resources").select("*").order("id"),
    supa.from("projects").select("*").order("created_at"),
    supa.from("materials").select("*"),
    supa.from("areas").select("*"),
    supa.from("bookings").select("*"),
  ]);
  const err = e1 || e2 || e3 || e4 || e5;
  if (err) throw err;

  const roster: Resource[] = (resources || []).map((r) => ({
    id: r.id,
    name: r.name,
    trade: r.trade,
    rate: canSeeFinance ? Number(r.rate) : 0,
    unit: r.unit,
  }));

  const projects: Project[] = (projRows || []).map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    revenue: canSeeFinance ? Number(p.revenue) || 0 : 0,
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

  return { roster, projects, bookings };
}

export async function ensureDefaultProject(p: Project) {
  const supa = getSupabase();
  const { error } = await supa
    .from("projects")
    .insert({ id: p.id, name: p.name, color: p.color, revenue: 0 });
  if (error) throw error;
}

/* projects — admin + editor can create/rename/delete projects and book against them;
   only admin can touch revenue (a cost/P&L figure). */
export async function insertProject(p: { id: string; name: string; color: string; revenue: number }) {
  await requireRole("admin", "editor");
  const supa = getSupabase();
  const { error } = await supa.from("projects").insert(p);
  if (error) throw error;
}
export async function updateProjectName(id: string, name: string) {
  await requireRole("admin", "editor");
  const supa = getSupabase();
  const { error } = await supa.from("projects").update({ name }).eq("id", id);
  if (error) throw error;
}
export async function updateProjectRevenue(id: string, revenue: number) {
  await requireTabAccess("pnl");
  const supa = getSupabase();
  const { error } = await supa.from("projects").update({ revenue }).eq("id", id);
  if (error) throw error;
}
export async function deleteProject(id: string) {
  await requireRole("admin", "editor");
  const supa = getSupabase();
  const { error } = await supa.from("projects").delete().eq("id", id);
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
  await supa.from("projects").delete().neq("id", "");
  await supa.from("resources").delete().neq("id", "");

  if (s.roster?.length) {
    const { error } = await supa
      .from("resources")
      .insert(s.roster.map((p) => ({ id: p.id, name: p.name, trade: p.trade, rate: p.rate, unit: p.unit })));
    if (error) throw error;
  }
  if (s.projects?.length) {
    const { error } = await supa
      .from("projects")
      .insert(s.projects.map((p) => ({ id: p.id, name: p.name, color: p.color, revenue: p.revenue || 0 })));
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
export async function uploadInvoice(formData: FormData) {
  await requireTabAccess("pnl");
  const projectId = formData.get("projectId") as string;
  const file = formData.get("file") as File | null;
  if (!projectId || !file) throw new Error("Missing file or project.");
  const supa = getSupabase();
  const buffer = Buffer.from(await file.arrayBuffer());
  assertWithinUploadLimit(buffer);
  const path = `${projectId}/${Date.now()}_${file.name}`;
  const { error: upErr } = await supa
    .storage
    .from("invoices")
    .upload(path, buffer, { contentType: file.type || "application/octet-stream" });
  if (upErr) throw upErr;
  const { error: insErr } = await supa.from("invoices").insert({ project_id: projectId, file_name: file.name, storage_path: path });
  if (insErr) throw insErr;
}
export async function deleteInvoice(id: string) {
  await requireTabAccess("pnl");
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

export async function uploadScopeDrawing(formData: FormData) {
  const role = await requireTabAccess("pnl");
  const projectId = formData.get("projectId") as string;
  const file = formData.get("file") as File | null;
  if (!projectId || !file) throw new Error("Missing file or project.");
  const supa = getSupabase();

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

  const { userId } = await auth();
  const buffer = Buffer.from(await file.arrayBuffer());
  assertWithinUploadLimit(buffer);
  const path = `${projectId}/${Date.now()}_${file.name}`;
  const { error: upErr } = await supa
    .storage
    .from("scope-drawings")
    .upload(path, buffer, { contentType: file.type || "application/octet-stream" });
  if (upErr) throw upErr;

  if (existing) {
    const { error: updErr } = await supa
      .from("scope_drawings")
      .update({ file_name: file.name, storage_path: path, uploaded_by: userId, uploaded_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (updErr) throw updErr;
    await supa.storage.from("scope-drawings").remove([existing.storage_path]);
  } else {
    const { error: insErr } = await supa
      .from("scope_drawings")
      .insert({ project_id: projectId, file_name: file.name, storage_path: path, uploaded_by: userId });
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
