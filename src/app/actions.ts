"use server";

import { getSupabase } from "@/lib/supabase";
import type { AppState, Band, Loc, Project, Resource } from "@/lib/types";
import { bkey } from "@/lib/types";

export async function loadState(): Promise<{
  roster: Resource[];
  projects: Project[];
  bookings: AppState["bookings"];
}> {
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
    rate: Number(r.rate),
    unit: r.unit,
  }));

  const projects: Project[] = (projRows || []).map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    revenue: Number(p.revenue) || 0,
    materials: [],
    areas: {},
  }));
  const byId: Record<string, Project> = {};
  projects.forEach((p) => (byId[p.id] = p));
  (matRows || []).forEach((m) => {
    const p = byId[m.project_id];
    if (p) p.materials.push({ id: m.id, item: m.item || "", cost: Number(m.cost) || 0 });
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

  return { roster, projects, bookings };
}

export async function ensureDefaultProject(p: Project) {
  const supa = getSupabase();
  const { error } = await supa
    .from("projects")
    .insert({ id: p.id, name: p.name, color: p.color, revenue: 0 });
  if (error) throw error;
}

/* projects */
export async function insertProject(p: { id: string; name: string; color: string; revenue: number }) {
  const supa = getSupabase();
  const { error } = await supa.from("projects").insert(p);
  if (error) throw error;
}
export async function updateProjectName(id: string, name: string) {
  const supa = getSupabase();
  const { error } = await supa.from("projects").update({ name }).eq("id", id);
  if (error) throw error;
}
export async function updateProjectRevenue(id: string, revenue: number) {
  const supa = getSupabase();
  const { error } = await supa.from("projects").update({ revenue }).eq("id", id);
  if (error) throw error;
}
export async function deleteProject(id: string) {
  const supa = getSupabase();
  const { error } = await supa.from("projects").delete().eq("id", id);
  if (error) throw error;
}

/* bookings */
export async function upsertBooking(
  date: string,
  resourceId: string,
  band: Band,
  projectId: string,
  loc: Loc,
  hrs?: number,
) {
  const supa = getSupabase();
  const row: Record<string, unknown> = { date, resource_id: resourceId, band, project_id: projectId, loc };
  if (band === "O") row.hrs = hrs;
  const { error } = await supa.from("bookings").upsert(row, { onConflict: "date,resource_id,band" });
  if (error) throw error;
}
export async function deleteBooking(date: string, resourceId: string, band: Band) {
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
  const supa = getSupabase();
  const { error } = await supa
    .from("bookings")
    .update({ project_id: targetProjectId })
    .eq("date", date)
    .eq("resource_id", resourceId)
    .eq("band", band);
  if (error) throw error;
}

/* materials */
export async function insertMaterial(id: string, projectId: string) {
  const supa = getSupabase();
  const { error } = await supa.from("materials").insert({ id, project_id: projectId, item: "", cost: 0 });
  if (error) throw error;
}
export async function updateMaterial(id: string, patch: { item?: string; cost?: number }) {
  const supa = getSupabase();
  const { error } = await supa.from("materials").update(patch).eq("id", id);
  if (error) throw error;
}
export async function deleteMaterial(id: string) {
  const supa = getSupabase();
  const { error } = await supa.from("materials").delete().eq("id", id);
  if (error) throw error;
}

/* areas */
export async function insertArea(id: string, projectId: string, resourceId: string) {
  const supa = getSupabase();
  const { error } = await supa
    .from("areas")
    .insert({ id, project_id: projectId, resource_id: resourceId, area_name: "", sqft: 0 });
  if (error) throw error;
}
export async function updateArea(id: string, patch: { area_name?: string; sqft?: number }) {
  const supa = getSupabase();
  const { error } = await supa.from("areas").update(patch).eq("id", id);
  if (error) throw error;
}
export async function deleteArea(id: string) {
  const supa = getSupabase();
  const { error } = await supa.from("areas").delete().eq("id", id);
  if (error) throw error;
}

/* resources (roster) */
export async function insertResource(r: Resource) {
  const supa = getSupabase();
  const { error } = await supa.from("resources").insert(r);
  if (error) throw error;
}
export async function updateResource(id: string, patch: Partial<Resource>) {
  const supa = getSupabase();
  const { error } = await supa.from("resources").update(patch).eq("id", id);
  if (error) throw error;
}
export async function deleteResource(id: string) {
  const supa = getSupabase();
  const { error } = await supa.from("resources").delete().eq("id", id);
  if (error) throw error;
}
export async function getRosterDefaults(): Promise<Resource[]> {
  const supa = getSupabase();
  const { data, error } = await supa.from("roster_defaults").select("*");
  if (error) throw error;
  return (data || []).map((r) => ({ id: r.id, name: r.name, trade: r.trade, rate: Number(r.rate), unit: r.unit }));
}
export async function resetRosterToDefaults(defaults: Resource[], removeIds: string[]) {
  const supa = getSupabase();
  if (removeIds.length) {
    const { error } = await supa.from("resources").delete().in("id", removeIds);
    if (error) throw error;
  }
  const { error } = await supa.from("resources").upsert(defaults);
  if (error) throw error;
}

/* bulk import (restore from JSON backup) */
export async function bulkReplaceState(s: AppState) {
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
