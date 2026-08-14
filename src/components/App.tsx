"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { UserButton } from "@clerk/nextjs";
import type { AreaLine, BaselineSowRow, BookingsMap, Loc, MaterialLine, ParentProject, Project, ProjectSowItem, PublicHoliday, Resource, ResourceLeave } from "@/lib/types";
import type { Role } from "@/lib/roles";
import { ALL_TAB_KEYS, TAB_LABELS, type TabKey } from "@/lib/tabs";
import { blankParentProject, blankProject } from "@/lib/calc";
import * as actions from "@/app/actions";
import Planner from "@/components/Planner";
import Pnl from "@/components/Pnl";
import Dashboard from "@/components/Dashboard";
import Bench from "@/components/Bench";
import Daily from "@/components/Daily";
import Roster from "@/components/Roster";
import Users from "@/components/Users";

const UI_KEY = "resPlanner.ui.v1";
type Tab = TabKey;

function loadUiPrefs(): { month?: string; currentParent?: string; current?: string } {
  try {
    return JSON.parse(localStorage.getItem(UI_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

export default function App({
  initialRoster,
  initialParentProjects,
  initialProjects,
  initialBookings,
  initialBaselineSow,
  initialLeaves,
  initialHolidays,
  role,
  currentUserId,
  allowedTabs,
}: {
  initialRoster: Resource[];
  initialParentProjects: ParentProject[];
  initialProjects: Project[];
  initialBookings: BookingsMap;
  initialBaselineSow: BaselineSowRow[];
  initialLeaves: ResourceLeave[];
  initialHolidays: PublicHoliday[];
  role: Role;
  currentUserId: string;
  allowedTabs: TabKey[];
}) {
  const isAdmin = role === "admin";
  const isViewer = role === "viewer";
  const canSee = (tab: Tab) => isAdmin || (tab !== "users" && allowedTabs.includes(tab));
  const [roster, setRoster] = useState<Resource[]>(initialRoster);
  const [parentProjects, setParentProjects] = useState<ParentProject[]>(initialParentProjects);
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [bookings, setBookings] = useState<BookingsMap>(initialBookings);
  const [baselineSow, setBaselineSow] = useState<BaselineSowRow[]>(initialBaselineSow);
  const [leaves, setLeaves] = useState<ResourceLeave[]>(initialLeaves);
  const [holidays, setHolidays] = useState<PublicHoliday[]>(initialHolidays);
  const [month, setMonth] = useState<string>(() => new Date().toISOString().slice(0, 7));
  const [currentParent, setCurrentParent] = useState<string>(initialParentProjects[0]?.id ?? "");
  const [current, setCurrent] = useState<string>(
    initialProjects.find((p) => p.parentProjectId === initialParentProjects[0]?.id)?.id ?? "",
  );
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const canSeeAtMount = (tab: Tab) => role === "admin" || (tab !== "users" && allowedTabs.includes(tab));
    return ALL_TAB_KEYS.find(canSeeAtMount) ?? "plan";
  });
  const [saved, setSaved] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());

  // hydrate UI-only prefs (month/current) from localStorage after mount
  useEffect(() => {
    const ui = loadUiPrefs();
    if (ui.month) setMonth(ui.month);
    if (ui.currentParent && parentProjects.some((pp) => pp.id === ui.currentParent)) setCurrentParent(ui.currentParent);
    if (ui.current && projects.some((p) => p.id === ui.current)) setCurrent(ui.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({ month, currentParent, current }));
    } catch {
      /* ignore */
    }
  }, [month, currentParent, current]);

  function markSaved() {
    setSaved(true);
    window.clearTimeout((markSaved as unknown as { t?: number }).t);
    (markSaved as unknown as { t?: number }).t = window.setTimeout(() => setSaved(false), 900);
  }
  function fail(err: unknown) {
    console.error(err);
    alert("Could not save to the database:\n" + (err instanceof Error ? err.message : String(err)));
  }

  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  function debounced(key: string, fn: () => void, ms = 400) {
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(fn, ms);
  }

  const curProj = useMemo(() => projects.find((p) => p.id === current), [projects, current]);
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renamingParentId, setRenamingParentId] = useState<string | null>(null);

  /* ---------- parent project mutations ---------- */
  function selectParent(id: string) {
    setCurrentParent(id);
    const firstSub = projects.find((p) => p.parentProjectId === id);
    setCurrent(firstSub?.id ?? "");
  }
  function addParentProject() {
    const pp = blankParentProject("Project " + (parentProjects.length + 1));
    setParentProjects((prev) => [...prev, pp]);
    setCurrentParent(pp.id);
    setCurrent("");
    setRenamingParentId(pp.id);
    markSaved();
    actions.insertParentProject({ id: pp.id, name: pp.name }).catch(fail);
  }
  function renameParentProject(id: string, name: string) {
    setParentProjects((prev) => prev.map((pp) => (pp.id === id ? { ...pp, name } : pp)));
    markSaved();
    debounced("parent-name:" + id, () => actions.updateParentProjectName(id, name).catch(fail));
  }
  function setCustomerHoDate(id: string, date: string) {
    setParentProjects((prev) => prev.map((pp) => (pp.id === id ? { ...pp, customerHoDate: date || null } : pp)));
    markSaved();
    debounced("parent-ho:" + id, () => actions.updateCustomerHoDate(id, date || null).catch(fail));
  }
  function setProjectStartDate(id: string, date: string) {
    setParentProjects((prev) => prev.map((pp) => (pp.id === id ? { ...pp, projectStartDate: date || null } : pp)));
    markSaved();
    debounced("parent-start:" + id, () => actions.updateProjectStartDate(id, date || null).catch(fail));
  }
  function deleteParentProject(id: string) {
    const pp = parentProjects.find((x) => x.id === id);
    const subs = projects.filter((p) => p.parentProjectId === id);
    if (!pp || !confirm(`Delete "${pp.name}" and all ${subs.length} of its sub-projects? This cannot be undone.`)) return;
    const subIds = new Set(subs.map((s) => s.id));
    setBookings((prev) => {
      const next = { ...prev };
      for (const k in next) if (subIds.has(next[k].proj)) delete next[k];
      return next;
    });
    setProjects((prev) => prev.filter((p) => p.parentProjectId !== id));
    setParentProjects((prev) => {
      const rest = prev.filter((x) => x.id !== id);
      if (currentParent === id) {
        setCurrentParent(rest[0]?.id ?? "");
        setCurrent(rest[0] ? projects.find((p) => p.parentProjectId === rest[0].id)?.id ?? "" : "");
      }
      return rest;
    });
    markSaved();
    actions.deleteParentProject(id).catch(fail);
  }

  /* ---------- sub-project mutations ---------- */
  function addProject() {
    if (!currentParent) {
      alert("Create or select a project first.");
      return;
    }
    const subsOfParent = projects.filter((p) => p.parentProjectId === currentParent);
    const p = blankProject("Sub-project " + (subsOfParent.length + 1), projects.length, currentParent);
    setProjects((prev) => [...prev, p]);
    setCurrent(p.id);
    setRenamingProjectId(p.id);
    markSaved();
    actions.insertProject({ id: p.id, name: p.name, color: p.color, revenue: 0, parentProjectId: currentParent }).catch(fail);
  }
  function renameProject(id: string, name: string) {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
    markSaved();
    debounced("project-name:" + id, () => actions.updateProjectName(id, name).catch(fail));
  }
  function setRevenue(id: string, revenue: number) {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, revenue } : p)));
    markSaved();
    debounced("project-revenue:" + id, () => actions.updateProjectRevenue(id, revenue).catch(fail));
  }
  function setProjectTargets(id: string, targetMarginPct: number | null, targetLabourCost: number | null) {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, targetMarginPct, targetLabourCost } : p)));
    markSaved();
    debounced("project-targets:" + id, () => actions.updateProjectTargets(id, targetMarginPct, targetLabourCost).catch(fail));
  }
  /* Creates (or returns) a sub-project with a given name under the current parent. Used by the
     contract-resource flow for scopes the scheduler derives but no Project SOW row created —
     e.g. Material Dispatch, which rides along on Modular Furniture's dependency chain. Giving
     it a real sub-project of its own is what makes it a permanent Sub-scope (Trade) chip and
     puts its contracted cost on the Activity/Scope P&L under its own name rather than buried
     inside whichever scope happened to trigger it. */
  function ensureNamedSubProject(name: string, scopeKey?: string): Project {
    // Activity-scoped sub-scopes are found by their scopeKey, never by name — two of them can
    // legitimately share a display name ("Counter Top" appears as two Baseline SOW activities).
    // Dept-scoped ones keep the original name lookup.
    const existing = projects.find((p) =>
      p.parentProjectId === currentParent &&
      (scopeKey
        ? p.scopeKey === scopeKey
        : !p.scopeKey && p.name.trim().toLowerCase() === name.trim().toLowerCase()),
    );
    if (existing) return existing;
    const p = { ...blankProject(name, projects.length, currentParent), scopeKey };
    setProjects((prev) => [...prev, p]);
    markSaved();
    actions
      .insertProject({ id: p.id, name: p.name, color: p.color, revenue: 0, parentProjectId: currentParent, scopeKey })
      .catch(fail);
    return p;
  }

  async function uploadProjectSow(
    parentProjectId: string,
    items: Omit<ProjectSowItem, "id">[],
    startDate?: string,
  ): Promise<{ created: number; updated: number }> {
    const parent = parentProjects.find((pp) => pp.id === parentProjectId);
    if (startDate && parent && !parent.projectStartDate) {
      setProjectStartDate(parentProjectId, startDate);
    }
    // Sub-projects are grouped by Dept (looked up from Baseline SOW by SOW1/SOW2), not SOW1 —
    // Dept is the coarser scope the resource-allocation side also understands. An item whose
    // SOW1/SOW2 has no Baseline SOW match yet (nothing to look up a Dept from) falls back to
    // grouping by its own SOW1, same as before, so nothing is silently dropped.
    const deptByKey = new Map<string, string>();
    baselineSow.forEach((b) => {
      const key = b.sow1.trim().toLowerCase() + "|" + b.sow2.trim().toLowerCase();
      if (!deptByKey.has(key)) deptByKey.set(key, b.dept.trim());
    });
    const groupNameFor = (it: Omit<ProjectSowItem, "id">) => {
      const key = it.sow1.trim().toLowerCase() + "|" + it.sow2.trim().toLowerCase();
      const dept = deptByKey.get(key);
      return dept || it.sow1.trim();
    };
    const groups = new Map<string, Omit<ProjectSowItem, "id">[]>();
    items.forEach((it) => {
      const key = groupNameFor(it);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(it);
    });
    const existingSubs = projects.filter((p) => p.parentProjectId === parentProjectId);
    let created = 0;
    let updated = 0;
    for (const [groupName, groupItems] of groups) {
      const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 4);
      const withIds: ProjectSowItem[] = groupItems.map((it, i) => ({ id: "sowi" + stamp + i.toString(36), ...it }));
      // Skip activity-scoped sub-scopes: they're contract engagements for one scheduler row,
      // not Dept groupings, so a SOW upload must never absorb or overwrite them even when the
      // display name happens to match.
      const existing = existingSubs.find((p) => !p.scopeKey && p.name.trim().toLowerCase() === groupName.toLowerCase());
      if (existing) {
        await actions.deleteProjectSowItemsForSubProject(existing.id);
        await actions.insertProjectSowItems(withIds.map((it) => ({ ...it, subProjectId: existing.id })));
        setProjects((prev) => prev.map((p) => (p.id === existing.id ? { ...p, sowItems: withIds } : p)));
        updated++;
      } else {
        const p = blankProject(groupName, projects.length + created, parentProjectId);
        p.sowItems = withIds;
        await actions.insertProject({ id: p.id, name: p.name, color: p.color, revenue: 0, parentProjectId });
        await actions.insertProjectSowItems(withIds.map((it) => ({ ...it, subProjectId: p.id })));
        setProjects((prev) => [...prev, p]);
        created++;
      }
    }
    markSaved();
    return { created, updated };
  }

  /* Commits the scheduler's computed activities + assigned people into real bookings — the
     "Generate schedule" action (a deliberate reversal of the earlier visual-only design, per
     the user's 2026-08-12 request). Applies optimistically like every other booking mutation,
     skipping any cell another project already holds so it never clobbers a manual booking;
     the server-side bulk action re-checks the same rule authoritatively. */
  async function generateBookingsFromSchedule(
    entries: { date: string; resourceId: string; projectId: string; loc: Loc }[],
  ): Promise<{ inserted: number; skipped: number }> {
    const toApply = entries.filter((e) => {
      const existing = bookings[bookKey(e.date, e.resourceId, "P")];
      return !existing || existing.proj === e.projectId;
    });
    const skippedLocally = entries.length - toApply.length;
    if (toApply.length) {
      setBookings((prev) => {
        const next = { ...prev };
        toApply.forEach((e) => {
          next[bookKey(e.date, e.resourceId, "P")] = { proj: e.projectId, loc: e.loc };
        });
        return next;
      });
      markSaved();
    }
    const result = await actions.bulkUpsertBookings(
      toApply.map((e) => ({ date: e.date, resourceId: e.resourceId, projectId: e.projectId, loc: e.loc })),
    );
    return { inserted: result.inserted, skipped: skippedLocally + result.skipped };
  }

  /* "Clear Table Contents" — wipes every sub-project under a parent project (freeing their
     bookings) so a fresh Project SOW upload starts clean instead of piling up duplicate
     sub-projects each time the same file gets re-uploaded. */
  function clearSubProjectsForParent(parentProjectId: string) {
    const subs = projects.filter((p) => p.parentProjectId === parentProjectId);
    if (!subs.length) {
      alert("No sub-projects to clear for this project.");
      return;
    }
    const subIds = new Set(subs.map((s) => s.id));
    const bookingCount = Object.values(bookings).filter((b) => subIds.has(b.proj)).length;
    if (
      !confirm(
        `Clear all ${subs.length} sub-project(s) for this project (${subs.map((s) => s.name).join(", ")})?\n\n` +
          `This deletes their uploaded SOW items and frees ${bookingCount} booking cell(s). This cannot be undone.`,
      )
    )
      return;
    setBookings((prev) => {
      const next = { ...prev };
      for (const k in next) if (subIds.has(next[k].proj)) delete next[k];
      return next;
    });
    setProjects((prev) => prev.filter((p) => p.parentProjectId !== parentProjectId));
    if (subIds.has(current)) setCurrent("");
    markSaved();
    actions.clearSubProjectsForParent(parentProjectId).catch(fail);
  }

  function reassignProjectParent(id: string, parentProjectId: string) {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, parentProjectId } : p)));
    markSaved();
    actions.updateProjectParent(id, parentProjectId).catch(fail);
  }
  function deleteProject(id: string) {
    const proj = projects.find((p) => p.id === id);
    if (!proj || !confirm(`Delete "${proj.name}"? Its bookings will be freed.`)) return;
    setBookings((prev) => {
      const next = { ...prev };
      for (const k in next) if (next[k].proj === id) delete next[k];
      return next;
    });
    setProjects((prev) => {
      const rest = prev.filter((p) => p.id !== id);
      if (current === id) {
        const sameParent = rest.find((p) => p.parentProjectId === proj.parentProjectId);
        setCurrent(sameParent?.id ?? "");
      }
      return rest;
    });
    markSaved();
    actions.deleteProject(id).catch(fail);
  }

  /* ---------- booking mutations ---------- */
  function bookKey(date: string, resId: string, band: "P" | "O") {
    return `${date}|${resId}|${band}`;
  }
  function setPrimary(date: string, resId: string) {
    if (!current) return;
    const key = bookKey(date, resId, "P");
    if (bookings[key]) return;
    setBookings((prev) => ({ ...prev, [key]: { proj: current, loc: activeLoc } }));
    markSaved();
    actions.upsertBooking(date, resId, "P", current, activeLoc).catch(fail);
  }
  function clearPrimary(date: string, resId: string) {
    const key = bookKey(date, resId, "P");
    const b = bookings[key];
    if (!b || b.proj !== current) return;
    setBookings((prev) => {
      const next = { ...prev };
      delete next[key];
      const ok = bookKey(date, resId, "O");
      delete next[ok];
      return next;
    });
    setSelection((prev) => {
      const next = new Set(prev);
      next.delete(key);
      next.delete(bookKey(date, resId, "O"));
      return next;
    });
    markSaved();
    actions.deleteBooking(date, resId, "P").catch(fail);
    actions.deleteBooking(date, resId, "O").catch(fail);
  }
  function cycleOt(date: string, resId: string) {
    if (!current) return;
    const key = bookKey(date, resId, "O");
    const b = bookings[key];
    if (b && b.hrs && b.proj !== current) return;
    if (!bookings[bookKey(date, resId, "P")]) {
      alert("OT needs a primary booking on this day first (it can be a different project).");
      return;
    }
    let hrs = b ? b.hrs || 0 : 0;
    hrs = (hrs + 1) % 6;
    if (hrs === 0) {
      setBookings((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setSelection((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      markSaved();
      actions.deleteBooking(date, resId, "O").catch(fail);
    } else {
      setBookings((prev) => ({ ...prev, [key]: { proj: current, loc: activeLoc, hrs } }));
      markSaved();
      actions.upsertBooking(date, resId, "O", current, activeLoc, hrs).catch(fail);
    }
  }
  function toggleSelect(key: string) {
    setSelection((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
    markSaved();
  }
  function moveSelected(target: string) {
    const keys = [...selection];
    setBookings((prev) => {
      const next = { ...prev };
      keys.forEach((k) => {
        if (next[k]) next[k] = { ...next[k], proj: target };
      });
      return next;
    });
    keys.forEach((k) => {
      const [date, resId, band] = k.split("|") as [string, string, "P" | "O"];
      actions.moveBooking(date, resId, band, target).catch(fail);
    });
    setSelection(new Set());
    markSaved();
  }

  const [activeLoc, setActiveLoc] = useState<"site" | "factory">("site");

  /* ---------- material mutations ---------- */
  function addMaterial() {
    if (!curProj) return;
    const m: MaterialLine = { id: crypto.randomUUID(), item: "", cost: 0 };
    setProjects((prev) => prev.map((p) => (p.id === curProj.id ? { ...p, materials: [...p.materials, m] } : p)));
    markSaved();
    actions.insertMaterial(m.id, curProj.id).catch(fail);
  }
  function updateMaterial(id: string, patch: Partial<MaterialLine>) {
    if (!curProj) return;
    setProjects((prev) =>
      prev.map((p) => (p.id === curProj.id ? { ...p, materials: p.materials.map((m) => (m.id === id ? { ...m, ...patch } : m)) } : p)),
    );
    markSaved();
    const field = Object.keys(patch)[0] || "";
    debounced("material:" + id + ":" + field, () => actions.updateMaterial(id, { item: patch.item, cost: patch.cost }).catch(fail));
  }
  function deleteMaterial(id: string) {
    if (!curProj) return;
    setProjects((prev) => prev.map((p) => (p.id === curProj.id ? { ...p, materials: p.materials.filter((m) => m.id !== id) } : p)));
    markSaved();
    actions.deleteMaterial(id).catch(fail);
  }

  /* ---------- area mutations ---------- */
  function ensureAreaRow(resId: string) {
    if (!curProj) return;
    if (curProj.areas[resId]?.length) return;
    const row: AreaLine = { id: crypto.randomUUID(), area: "", sqft: 0 };
    setProjects((prev) =>
      prev.map((p) => (p.id === curProj.id ? { ...p, areas: { ...p.areas, [resId]: [row] } } : p)),
    );
    actions.insertArea(row.id, curProj.id, resId).catch(fail);
  }
  function addArea(resId: string) {
    if (!curProj) return;
    const row: AreaLine = { id: crypto.randomUUID(), area: "", sqft: 0 };
    setProjects((prev) =>
      prev.map((p) => (p.id === curProj.id ? { ...p, areas: { ...p.areas, [resId]: [...(p.areas[resId] || []), row] } } : p)),
    );
    markSaved();
    actions.insertArea(row.id, curProj.id, resId).catch(fail);
  }
  function updateArea(resId: string, id: string, patch: Partial<AreaLine>) {
    if (!curProj) return;
    setProjects((prev) =>
      prev.map((p) =>
        p.id === curProj.id
          ? { ...p, areas: { ...p.areas, [resId]: (p.areas[resId] || []).map((a) => (a.id === id ? { ...a, ...patch } : a)) } }
          : p,
      ),
    );
    markSaved();
    const field = Object.keys(patch)[0] || "";
    debounced("area:" + id + ":" + field, () => actions.updateArea(id, { area_name: patch.area, sqft: patch.sqft }).catch(fail));
  }
  function deleteArea(resId: string, id: string) {
    if (!curProj) return;
    const remaining = (curProj.areas[resId] || []).filter((a) => a.id !== id);
    let replacement: AreaLine | null = null;
    if (!remaining.length) {
      replacement = { id: crypto.randomUUID(), area: "", sqft: 0 };
    }
    setProjects((prev) =>
      prev.map((p) =>
        p.id === curProj.id ? { ...p, areas: { ...p.areas, [resId]: replacement ? [replacement] : remaining } } : p,
      ),
    );
    markSaved();
    actions.deleteArea(id).catch(fail);
    if (replacement) actions.insertArea(replacement.id, curProj.id, resId).catch(fail);
  }

  /* ---------- roster mutations ---------- */
  /* Returns the created resource so callers that need its id straight away can use it — the
     contract-resource flow on the Planner books the new person onto the scheduler's dates
     immediately, which needs the id before the next render. */
  function addPerson(r: Omit<Resource, "id">): Resource {
    const p: Resource = { id: "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ...r };
    setRoster((prev) => [...prev, p]);
    markSaved();
    actions.insertResource(p).catch(fail);
    return p;
  }
  function uploadResourcesExcel(rows: Omit<Resource, "id">[]) {
    if (!rows.length) return;
    const stamp = Date.now().toString(36);
    const created: Resource[] = rows.map((r, i) => ({
      id: "r" + stamp + i.toString(36) + Math.random().toString(36).slice(2, 5),
      ...r,
    }));
    setRoster((prev) => [...prev, ...created]);
    markSaved();
    actions.insertResourcesBulk(created).catch(fail);
  }
  function updatePerson(id: string, patch: Partial<Resource>) {
    setRoster((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    markSaved();
    const field = Object.keys(patch)[0] || "";
    debounced("resource:" + id + ":" + field, () => actions.updateResource(id, patch).catch(fail));
  }
  function deletePerson(id: string, name: string) {
    if (!confirm(`Remove ${name}? Their bookings will be cleared.`)) return;
    setBookings((prev) => {
      const next = { ...prev };
      for (const k in next) if (k.split("|")[1] === id) delete next[k];
      return next;
    });
    setProjects((prev) => prev.map((p) => ({ ...p, areas: Object.fromEntries(Object.entries(p.areas).filter(([rid]) => rid !== id)) })));
    setRoster((prev) => prev.filter((p) => p.id !== id));
    markSaved();
    actions.deleteResource(id).catch(fail);
  }
  async function resetRoster() {
    if (!confirm("Reset roster to original Manpower list? Custom people and their bookings are removed.")) return;
    try {
      const defaults = await actions.getRosterDefaults();
      if (!defaults.length) {
        alert("No default roster snapshot found in the database.");
        return;
      }
      const ids = new Set(defaults.map((p) => p.id));
      setBookings((prev) => {
        const next = { ...prev };
        for (const k in next) if (!ids.has(k.split("|")[1])) delete next[k];
        return next;
      });
      const toRemove = roster.filter((p) => !ids.has(p.id)).map((p) => p.id);
      setRoster(defaults);
      markSaved();
      await actions.resetRosterToDefaults(defaults, toRemove);
    } catch (e) {
      fail(e);
    }
  }
  async function clearRoster() {
    if (
      !confirm(
        `Delete all ${roster.length} resources and their bookings? This cannot be undone. Use this before re-uploading an Excel file to avoid duplicates.`,
      )
    )
      return;
    try {
      await actions.clearAllResources();
      setRoster([]);
      setBookings({});
      setProjects((prev) => prev.map((p) => ({ ...p, areas: {} })));
      markSaved();
    } catch (e) {
      fail(e);
    }
  }
  async function importBackup(s: {
    roster: Resource[];
    parentProjects?: ParentProject[];
    projects: Project[];
    bookings: BookingsMap;
    month?: string;
    current?: string;
  }) {
    if (!confirm("This will REPLACE all data in the shared database with the contents of this file. Continue?")) return;
    try {
      await actions.bulkReplaceState({
        month: s.month || month,
        roster: s.roster,
        parentProjects: s.parentProjects || [],
        projects: s.projects,
        currentParent: currentParent,
        current: s.current || current,
        bookings: s.bookings,
        baselineSow,
        leaves,
        holidays,
      });
      const fresh = await actions.loadState();
      setRoster(fresh.roster);
      setParentProjects(fresh.parentProjects);
      setProjects(fresh.projects);
      setBookings(fresh.bookings);
      setBaselineSow(fresh.baselineSow);
      setLeaves(fresh.leaves);
      setHolidays(fresh.holidays);
      setCurrentParent(fresh.parentProjects[0]?.id ?? "");
      setCurrent(fresh.projects.find((p) => p.parentProjectId === fresh.parentProjects[0]?.id)?.id ?? "");
      markSaved();
    } catch (e) {
      fail(e);
    }
  }

  /* ---------- Baseline SOW / leaves / holidays mutations ---------- */
  async function uploadBaselineSow(rows: Omit<BaselineSowRow, "id">[]) {
    const stamp = Date.now().toString(36);
    const created: BaselineSowRow[] = rows.map((r, i) => ({ id: "sow" + stamp + i.toString(36), ...r }));
    try {
      await actions.replaceBaselineSow(created);
      setBaselineSow(created);
      markSaved();
    } catch (e) {
      fail(e);
    }
  }
  /* Inline edit of one Baseline SOW row. Debounced per-field like the roster's edits, so
     typing in a text cell doesn't fire a write per keystroke. */
  function updateBaselineSowRow(id: string, patch: Partial<BaselineSowRow>) {
    setBaselineSow((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    markSaved();
    const field = Object.keys(patch)[0] || "";
    debounced("baseline-sow:" + id + ":" + field, () => actions.updateBaselineSowRow(id, patch).catch(fail));
  }
  function deleteBaselineSowRow(id: string) {
    setBaselineSow((prev) => prev.filter((r) => r.id !== id));
    markSaved();
    actions.deleteBaselineSowRow(id).catch(fail);
  }
  function addLeave(resourceId: string, startDate: string, endDate: string, reason: string) {
    const l: ResourceLeave = { id: "lv" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), resourceId, startDate, endDate, reason };
    setLeaves((prev) => [...prev, l]);
    markSaved();
    actions.insertResourceLeave(l).catch(fail);
  }
  function deleteLeave(id: string) {
    setLeaves((prev) => prev.filter((l) => l.id !== id));
    markSaved();
    actions.deleteResourceLeave(id).catch(fail);
  }
  function addHoliday(date: string, label: string) {
    const h: PublicHoliday = { id: "ph" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), date, label };
    setHolidays((prev) => [...prev, h].sort((a, b) => a.date.localeCompare(b.date)));
    markSaved();
    actions.insertPublicHoliday(h).catch(fail);
  }
  function deleteHoliday(id: string) {
    setHolidays((prev) => prev.filter((h) => h.id !== id));
    markSaved();
    actions.deletePublicHoliday(id).catch(fail);
  }

  const state = { month, roster, parentProjects, projects, currentParent, current, bookings, baselineSow, leaves, holidays };

  return (
    <div className="wrap">
      <header className="top">
        <div className="brand">
          <h1>Resource Planner &amp; Project P&amp;L</h1>
          <p>Calendar bookings with OT and site/factory, double-booking guards, bench &amp; multi-month P&amp;L.</p>
        </div>
        <div className="row">
          <span className={"save-dot" + (saved ? " show" : "")}>Saved ✓</span>
          <span className="badge b-day" style={{ textTransform: "capitalize" }}>
            {role}
          </span>
          <UserButton />
        </div>
      </header>

      <div className="tabs">
        {ALL_TAB_KEYS.filter(canSee).map((id) => (
          <button key={id} className={"tab" + (activeTab === id ? " active" : "")} onClick={() => setActiveTab(id)}>
            {TAB_LABELS[id]}
          </button>
        ))}
      </div>

      {canSee("plan") && (
        <section className={"panel" + (activeTab === "plan" ? " active" : "")}>
          <Planner
            state={state}
            activeLoc={activeLoc}
            setActiveLoc={setActiveLoc}
            selection={selection}
            readOnly={isViewer}
            isAdmin={isAdmin}
            renamingProjectId={renamingProjectId}
            renamingParentId={renamingParentId}
            onSelectParent={selectParent}
            onAddParentProject={addParentProject}
            onRenameParent={renameParentProject}
            onRenameParentDone={() => setRenamingParentId(null)}
            onSetProjectStartDate={setProjectStartDate}
            onSetCurrent={setCurrent}
            onAddProject={addProject}
            onRename={renameProject}
            onRenameDone={() => setRenamingProjectId(null)}
            onSetPrimary={setPrimary}
            onClearPrimary={clearPrimary}
            onCycleOt={cycleOt}
            onToggleSelect={toggleSelect}
            onClearSelection={() => {
              setSelection(new Set());
              markSaved();
            }}
            onMoveSelected={moveSelected}
            onUploadProjectSow={uploadProjectSow}
            onClearSubProjects={clearSubProjectsForParent}
            onGenerateBookings={generateBookingsFromSchedule}
            onSetMonth={setMonth}
            onAddPerson={addPerson}
            onEnsureSubProject={ensureNamedSubProject}
          />
        </section>
      )}

      {canSee("pnl") && (
        <section className={"panel" + (activeTab === "pnl" ? " active" : "")}>
          <Pnl
            state={state}
            isAdmin={isAdmin}
            onSelectParent={selectParent}
            onSetCurrent={setCurrent}
            onRename={renameProject}
            onSetRevenue={setRevenue}
            onSetTargets={setProjectTargets}
            onSetCustomerHoDate={setCustomerHoDate}
            onAddMaterial={addMaterial}
            onUpdateMaterial={updateMaterial}
            onDeleteMaterial={deleteMaterial}
            onEnsureArea={ensureAreaRow}
            onAddArea={addArea}
            onUpdateArea={updateArea}
            onDeleteArea={deleteArea}
          />
        </section>
      )}

      {canSee("dash") && (
        <section className={"panel" + (activeTab === "dash" ? " active" : "")}>
          <Dashboard state={state} />
        </section>
      )}

      {canSee("bench") && (
        <section className={"panel" + (activeTab === "bench" ? " active" : "")}>
          <Bench state={state} />
        </section>
      )}

      {canSee("daily") && (
        <section className={"panel" + (activeTab === "daily" ? " active" : "")}>
          <Daily state={state} />
        </section>
      )}

      {canSee("roster") && (
        <section className={"panel" + (activeTab === "roster" ? " active" : "")}>
          <Roster
            state={state}
            isAdmin={isAdmin}
            onAddPerson={addPerson}
            onUploadExcel={uploadResourcesExcel}
            onUpdatePerson={updatePerson}
            onDeletePerson={deletePerson}
            onReset={resetRoster}
            onClearAll={clearRoster}
            onImport={importBackup}
            onUploadBaselineSow={uploadBaselineSow}
            onUpdateBaselineSowRow={updateBaselineSowRow}
            onDeleteBaselineSowRow={deleteBaselineSowRow}
            onAddLeave={addLeave}
            onDeleteLeave={deleteLeave}
            onAddHoliday={addHoliday}
            onDeleteHoliday={deleteHoliday}
          />
        </section>
      )}

      {isAdmin && (
        <section className={"panel" + (activeTab === "users" ? " active" : "")}>
          <Users
            currentUserId={currentUserId}
            parentProjects={parentProjects}
            projects={projects}
            onDeleteProject={deleteProject}
            onDeleteParentProject={deleteParentProject}
            onReassignProjectParent={reassignProjectParent}
          />
        </section>
      )}
    </div>
  );
}
