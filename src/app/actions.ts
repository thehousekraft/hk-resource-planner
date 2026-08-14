"use server";

import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { getAllowedTabs, getRole, requireRole, requireTabAccess } from "@/lib/roles";
import type { AppState, BaselineSowRow, Band, Loc, ManualDuration, ParentProject, Project, ProjectSowItem, PublicHoliday, Resource, ResourceLeave } from "@/lib/types";
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
  baselineSow: BaselineSowRow[];
  leaves: ResourceLeave[];
  holidays: PublicHoliday[];
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
    { data: sowRows, error: e6 },
    { data: leaveRows, error: e7 },
    { data: holidayRows, error: e8 },
    { data: sowItemRows, error: e9 },
  ] = await Promise.all([
    supa.from("resources").select("*").order("id"),
    supa.from("projects").select("*").order("created_at"),
    supa.from("sub_projects").select("*").order("created_at"),
    supa.from("materials").select("*"),
    supa.from("areas").select("*"),
    supa.from("bookings").select("*"),
    supa.from("baseline_sow").select("*").order("created_at"),
    supa.from("resource_leaves").select("*").order("start_date"),
    supa.from("public_holidays").select("*").order("date"),
    supa.from("project_sow_items").select("*").order("created_at"),
  ]);
  const err = e1 || e2 || e2b || e3 || e4 || e5 || e6 || e7 || e8 || e9;
  if (err) throw err;

  const baselineSow: BaselineSowRow[] = (sowRows || []).map((r) => ({
    id: r.id,
    orderOfWork: r.order_of_work || "",
    productName: r.product_name || "",
    sow1: r.sow1 || "",
    sow2: r.sow2 || "",
    dependencyScope: r.dependency_scope || "",
    dependentScope1: r.dependent_scope_1 || "",
    schedulerMethodology: r.scheduler_methodology || "",
    rateOfWork: Number(r.rate_of_work) || 0,
    uom: r.uom || "",
    minLabour: Number(r.min_labour) || 0,
    phaseOfWork: r.phase_of_work || "",
    trade1: r.trade1 || "",
    trade2: r.trade2 || "",
    material: r.material || "",
    activityDescription: r.activity_description || "",
    dept: r.dept || "",
    areaOrCount: r.area_or_count || "",
    calculation: r.calculation || "",
  }));
  const leaves: ResourceLeave[] = (leaveRows || []).map((r) => ({
    id: r.id,
    resourceId: r.resource_id,
    startDate: r.start_date,
    endDate: r.end_date,
    reason: r.reason || "",
  }));
  const holidays: PublicHoliday[] = (holidayRows || []).map((r) => ({
    id: r.id,
    date: r.date,
    label: r.label || "",
  }));

  const roster: Resource[] = (resources || []).map((r) => ({
    id: r.id,
    name: r.name,
    trade: r.trade,
    rate: canSeeFinance ? Number(r.rate) : 0,
    unit: r.unit,
    empId: r.emp_id || undefined,
    dept: r.dept || undefined,
    payoutType: r.payout_type || undefined,
    tradeCode: r.trade_code || undefined,
    seniority: r.seniority || undefined,
    resourceCode: r.resource_code || undefined,
    scopeKey: r.scope_key || undefined,
  }));

  const parentProjects: ParentProject[] = (parentRows || []).map((pp) => ({
    id: pp.id,
    name: pp.name,
    customerHoDate: pp.customer_ho_date || null,
    projectStartDate: pp.project_start_date || null,
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
    sowItems: [],
    scopeKey: p.scope_key || undefined,
  }));
  const byId: Record<string, Project> = {};
  projects.forEach((p) => (byId[p.id] = p));
  if (canSeeFinance) {
    (matRows || []).forEach((m) => {
      const p = byId[m.project_id];
      if (p) p.materials.push({ id: m.id, item: m.item || "", cost: Number(m.cost) || 0 });
    });
  }
  (sowItemRows || []).forEach((s) => {
    const p = byId[s.sub_project_id];
    if (!p) return;
    p.sowItems.push({
      id: s.id,
      area: s.area || "",
      productName: s.product_name || "",
      sow1: s.sow1 || "",
      sow2: s.sow2 || "",
      width: Number(s.width) || 0,
      height: Number(s.height) || 0,
      depth: Number(s.depth) || 0,
      sqft: Number(s.sqft) || 0,
      phase: s.phase || "",
    });
  });
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

  return { roster, parentProjects, projects, bookings, baselineSow, leaves, holidays };
}

/* Baseline SOW — admin-maintained rate-of-work reference library, uploaded as a whole
   sheet (replace-all, like the roster's "Clear all resources" pattern). */
export async function replaceBaselineSow(rows: BaselineSowRow[]) {
  await requireRole("admin");
  const supa = getSupabase();
  const { error: delErr } = await supa.from("baseline_sow").delete().neq("id", "");
  if (delErr) throw delErr;
  if (!rows.length) return;
  const { error } = await supa.from("baseline_sow").insert(
    rows.map((r) => ({
      id: r.id,
      order_of_work: r.orderOfWork,
      product_name: r.productName,
      sow1: r.sow1,
      sow2: r.sow2,
      dependency_scope: r.dependencyScope,
      dependent_scope_1: r.dependentScope1,
      scheduler_methodology: r.schedulerMethodology,
      rate_of_work: r.rateOfWork,
      uom: r.uom,
      min_labour: r.minLabour,
      phase_of_work: r.phaseOfWork,
      trade1: r.trade1,
      trade2: r.trade2,
      material: r.material,
      activity_description: r.activityDescription,
      dept: r.dept,
      area_or_count: r.areaOrCount,
      calculation: r.calculation,
    })),
  );
  if (error) throw error;
}
/* Inline edits to a single Baseline SOW row — lets admins correct the library in-app (e.g.
   flipping a Scheduler Methodology to "Manual", renumbering an Order of Work) instead of
   round-tripping through Excel and a full replace-all re-upload, which wipes any direct fixes. */
export async function updateBaselineSowRow(id: string, patch: Partial<BaselineSowRow>) {
  await requireRole("admin");
  const supa = getSupabase();
  const row: Record<string, unknown> = {};
  if (patch.orderOfWork !== undefined) row.order_of_work = patch.orderOfWork;
  if (patch.productName !== undefined) row.product_name = patch.productName;
  if (patch.sow1 !== undefined) row.sow1 = patch.sow1;
  if (patch.sow2 !== undefined) row.sow2 = patch.sow2;
  if (patch.dependencyScope !== undefined) row.dependency_scope = patch.dependencyScope;
  if (patch.dependentScope1 !== undefined) row.dependent_scope_1 = patch.dependentScope1;
  if (patch.schedulerMethodology !== undefined) row.scheduler_methodology = patch.schedulerMethodology;
  if (patch.rateOfWork !== undefined) row.rate_of_work = patch.rateOfWork;
  if (patch.uom !== undefined) row.uom = patch.uom;
  if (patch.minLabour !== undefined) row.min_labour = patch.minLabour;
  if (patch.phaseOfWork !== undefined) row.phase_of_work = patch.phaseOfWork;
  if (patch.trade1 !== undefined) row.trade1 = patch.trade1;
  if (patch.trade2 !== undefined) row.trade2 = patch.trade2;
  if (patch.material !== undefined) row.material = patch.material;
  if (patch.activityDescription !== undefined) row.activity_description = patch.activityDescription;
  if (patch.dept !== undefined) row.dept = patch.dept;
  if (patch.areaOrCount !== undefined) row.area_or_count = patch.areaOrCount;
  if (patch.calculation !== undefined) row.calculation = patch.calculation;
  if (!Object.keys(row).length) return;
  const { error } = await supa.from("baseline_sow").update(row).eq("id", id);
  if (error) throw error;
}

export async function deleteBaselineSowRow(id: string) {
  await requireRole("admin");
  const supa = getSupabase();
  const { error } = await supa.from("baseline_sow").delete().eq("id", id);
  if (error) throw error;
}

/* Resource leaves — admin-entered planned leave ranges; block calendar cells. */
export async function insertResourceLeave(l: ResourceLeave) {
  await requireRole("admin");
  const supa = getSupabase();
  const { error } = await supa
    .from("resource_leaves")
    .insert({ id: l.id, resource_id: l.resourceId, start_date: l.startDate, end_date: l.endDate, reason: l.reason });
  if (error) throw error;
}
export async function deleteResourceLeave(id: string) {
  await requireRole("admin");
  const supa = getSupabase();
  const { error } = await supa.from("resource_leaves").delete().eq("id", id);
  if (error) throw error;
}

/* Public holidays — admin-entered, global (not per-resource); block calendar cells. */
export async function insertPublicHoliday(h: PublicHoliday) {
  await requireRole("admin");
  const supa = getSupabase();
  const { error } = await supa.from("public_holidays").insert({ id: h.id, date: h.date, label: h.label });
  if (error) throw error;
}
export async function deletePublicHoliday(id: string) {
  await requireRole("admin");
  const supa = getSupabase();
  const { error } = await supa.from("public_holidays").delete().eq("id", id);
  if (error) throw error;
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
export async function updateProjectStartDate(id: string, projectStartDate: string | null) {
  await requireRole("admin", "editor");
  const supa = getSupabase();
  const { error } = await supa.from("projects").update({ project_start_date: projectStartDate }).eq("id", id);
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
export async function insertProject(p: {
  id: string;
  name: string;
  color: string;
  revenue: number;
  parentProjectId: string;
  scopeKey?: string;
}) {
  await requireRole("admin", "editor");
  const supa = getSupabase();
  const { error } = await supa.from("sub_projects").insert({
    id: p.id,
    name: p.name,
    color: p.color,
    revenue: p.revenue,
    parent_project_id: p.parentProjectId,
    scope_key: p.scopeKey || null,
  });
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
/* "Clear Table Contents" — wipes every sub-project (and, via cascade, its SOW items,
   bookings, materials, areas) under one parent project, so a fresh Project SOW upload starts
   from a clean slate instead of accumulating duplicate sub-projects from repeated uploads. */
export async function clearSubProjectsForParent(parentProjectId: string) {
  await requireRole("admin", "editor");
  const supa = getSupabase();
  const { error } = await supa.from("sub_projects").delete().eq("parent_project_id", parentProjectId);
  if (error) throw error;
}
/* Project SOW items — the raw rows behind an "Upload SOW" sub-project, kept for
   traceability. Re-uploading replaces a matched sub-project's items wholesale. */
export async function insertProjectSowItems(rows: (ProjectSowItem & { subProjectId: string })[]) {
  await requireRole("admin", "editor");
  if (!rows.length) return;
  const supa = getSupabase();
  const { error } = await supa.from("project_sow_items").insert(
    rows.map((r) => ({
      id: r.id,
      sub_project_id: r.subProjectId,
      area: r.area,
      product_name: r.productName,
      sow1: r.sow1,
      sow2: r.sow2,
      width: r.width,
      height: r.height,
      depth: r.depth,
      sqft: r.sqft,
      phase: r.phase,
    })),
  );
  if (error) throw error;
}
export async function deleteProjectSowItemsForSubProject(subProjectId: string) {
  await requireRole("admin", "editor");
  const supa = getSupabase();
  const { error } = await supa.from("project_sow_items").delete().eq("sub_project_id", subProjectId);
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
/** Batch-commits scheduler-computed activities into real bookings (the "Generate schedule"
 *  action) — one upsert call instead of one per resource-day, since a multi-week activity
 *  with several assigned people can be hundreds of cells. Skips any cell already booked by a
 *  different project so it never clobbers someone else's manual booking. */
export async function bulkUpsertBookings(
  rawEntries: { date: string; resourceId: string; projectId: string; loc: Loc }[],
) {
  await requireRole("admin", "editor");
  if (!rawEntries.length) return { inserted: 0, skipped: 0 };
  // A booking is unique per (date, resource, band). One resource can be assigned to several
  // activities whose date ranges overlap — e.g. a vendor covering two same-day scopes — which
  // would put the same cell in this batch twice and make Postgres reject the whole upsert
  // ("ON CONFLICT DO UPDATE command cannot affect row a second time"). First write wins.
  const seen = new Set<string>();
  const entries = rawEntries.filter((e) => {
    const key = e.date + "|" + e.resourceId;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const supa = getSupabase();
  const dates = [...new Set(entries.map((e) => e.date))];
  const resourceIds = [...new Set(entries.map((e) => e.resourceId))];
  const { data: existing, error: existErr } = await supa
    .from("bookings")
    .select("date,resource_id,project_id")
    .eq("band", "P")
    .in("date", dates)
    .in("resource_id", resourceIds);
  if (existErr) throw existErr;
  const takenByOther = new Set(
    (existing || []).filter((b) => !entries.some((e) => e.date === b.date && e.resourceId === b.resource_id && e.projectId === b.project_id)).map((b) => `${b.date}|${b.resource_id}`),
  );
  const toInsert = entries.filter((e) => !takenByOther.has(`${e.date}|${e.resourceId}`));
  const skipped = rawEntries.length - toInsert.length;
  if (!toInsert.length) return { inserted: 0, skipped };
  const { error } = await supa.from("bookings").upsert(
    toInsert.map((e) => ({ date: e.date, resource_id: e.resourceId, band: "P", project_id: e.projectId, loc: e.loc })),
    { onConflict: "date,resource_id,band" },
  );
  if (error) throw error;
  return { inserted: toInsert.length, skipped };
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
function resourceToRow(r: Resource) {
  return {
    id: r.id,
    name: r.name,
    trade: r.trade,
    rate: r.rate,
    unit: r.unit,
    emp_id: r.empId || null,
    dept: r.dept || null,
    payout_type: r.payoutType || null,
    trade_code: r.tradeCode || null,
    seniority: r.seniority || null,
    resource_code: r.resourceCode || null,
    scope_key: r.scopeKey || null,
  };
}
export async function insertResource(r: Resource) {
  await requireTabAccess("roster");
  const supa = getSupabase();
  const { error } = await supa.from("resources").insert(resourceToRow(r));
  if (error) throw error;
}
export async function insertResourcesBulk(rows: Resource[]) {
  await requireTabAccess("roster");
  if (!rows.length) return;
  const supa = getSupabase();
  const { error } = await supa.from("resources").upsert(rows.map(resourceToRow));
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
      .insert(
        s.parentProjects.map((pp) => ({
          id: pp.id,
          name: pp.name,
          customer_ho_date: pp.customerHoDate,
          project_start_date: pp.projectStartDate,
        })),
      );
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

/* Instructions / calculation-rules file — a single global admin-uploaded reference file
   (e.g. Instructions.xlsx), stored for record-keeping and versioning. Not parsed: the
   scheduling logic it documents lives in src/lib/scheduler.ts, not in this file's content. */
export interface InstructionsFileRow {
  fileName: string;
  url: string;
  uploadedAt: string;
}

export async function getInstructionsFile(): Promise<InstructionsFileRow | null> {
  const supa = getSupabase();
  const { data, error } = await supa.from("instructions_files").select("*").order("uploaded_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    fileName: data.file_name,
    uploadedAt: data.uploaded_at,
    url: supa.storage.from("instructions").getPublicUrl(data.storage_path).data.publicUrl,
  };
}

export async function createInstructionsUploadUrl(fileName: string, fileSize: number) {
  await requireRole("admin");
  assertWithinUploadLimit(fileSize);
  const supa = getSupabase();
  const path = `${Date.now()}_${fileName}`;
  const { data, error } = await supa.storage.from("instructions").createSignedUploadUrl(path);
  if (error) throw error;
  return { signedUrl: data.signedUrl, path };
}

export async function finalizeInstructionsUpload(path: string, fileName: string) {
  await requireRole("admin");
  const supa = getSupabase();
  const { userId } = await auth();
  const { data: existing, error: existErr } = await supa.from("instructions_files").select("id, storage_path").maybeSingle();
  if (existErr) throw existErr;
  if (existing) {
    const { error: updErr } = await supa
      .from("instructions_files")
      .update({ file_name: fileName, storage_path: path, uploaded_by: userId, uploaded_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (updErr) throw updErr;
    await supa.storage.from("instructions").remove([existing.storage_path]);
  } else {
    const { error: insErr } = await supa
      .from("instructions_files")
      .insert({ id: "instructions", file_name: fileName, storage_path: path, uploaded_by: userId });
    if (insErr) throw insErr;
  }
}

export async function deleteInstructionsFile() {
  await requireRole("admin");
  const supa = getSupabase();
  const { data: row, error: readErr } = await supa.from("instructions_files").select("id, storage_path").maybeSingle();
  if (readErr) throw readErr;
  if (!row) return;
  await supa.storage.from("instructions").remove([row.storage_path]);
  const { error } = await supa.from("instructions_files").delete().eq("id", row.id);
  if (error) throw error;
}

/* Manual scheduler durations — for activities whose Baseline SOW row has Scheduler
   Methodology "Manual" (e.g. Snag Correction, decided by the QC manager post-inspection
   rather than computed from a rate). One value per sub-project + SOW1/SOW2 combo. */
export async function getManualDurations(subProjectIds: string[]): Promise<ManualDuration[]> {
  if (!subProjectIds.length) return [];
  const supa = getSupabase();
  const { data, error } = await supa.from("manual_scheduler_durations").select("*").in("sub_project_id", subProjectIds);
  if (error) throw error;
  return (data || []).map((r) => ({ id: r.id, subProjectId: r.sub_project_id, sow1: r.sow1, sow2: r.sow2, days: Number(r.days) || 0 }));
}

export async function setManualDuration(subProjectId: string, sow1: string, sow2: string, days: number) {
  await requireRole("admin", "editor");
  const supa = getSupabase();
  const { userId } = await auth();
  const { error } = await supa.from("manual_scheduler_durations").upsert(
    {
      id: subProjectId + "|" + sow1 + "|" + sow2,
      sub_project_id: subProjectId,
      sow1,
      sow2,
      days,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "sub_project_id,sow1,sow2" },
  );
  if (error) throw error;
}
