"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { UserButton } from "@clerk/nextjs";
import type { AreaLine, BookingsMap, MaterialLine, Project, Resource } from "@/lib/types";
import type { Role } from "@/lib/roles";
import type { TabKey } from "@/lib/tabs";
import { blankProject } from "@/lib/calc";
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

function loadUiPrefs(): { month?: string; current?: string } {
  try {
    return JSON.parse(localStorage.getItem(UI_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

export default function App({
  initialRoster,
  initialProjects,
  initialBookings,
  role,
  currentUserId,
  allowedTabs,
}: {
  initialRoster: Resource[];
  initialProjects: Project[];
  initialBookings: BookingsMap;
  role: Role;
  currentUserId: string;
  allowedTabs: TabKey[];
}) {
  const isAdmin = role === "admin";
  const isViewer = role === "viewer";
  const canSee = (tab: Tab) => isAdmin || (tab !== "users" && allowedTabs.includes(tab));
  const [roster, setRoster] = useState<Resource[]>(initialRoster);
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [bookings, setBookings] = useState<BookingsMap>(initialBookings);
  const [month, setMonth] = useState<string>(() => new Date().toISOString().slice(0, 7));
  const [current, setCurrent] = useState<string>(initialProjects[0]?.id ?? "");
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const order: Tab[] = ["plan", "pnl", "dash", "bench", "daily", "roster", "users"];
    const canSeeAtMount = (tab: Tab) => role === "admin" || (tab !== "users" && allowedTabs.includes(tab));
    return order.find(canSeeAtMount) ?? "plan";
  });
  const [saved, setSaved] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());

  // hydrate UI-only prefs (month/current) from localStorage after mount
  useEffect(() => {
    const ui = loadUiPrefs();
    if (ui.month) setMonth(ui.month);
    if (ui.current && projects.some((p) => p.id === ui.current)) setCurrent(ui.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({ month, current }));
    } catch {
      /* ignore */
    }
  }, [month, current]);

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

  const curProj = useMemo(() => projects.find((p) => p.id === current) || projects[0], [projects, current]);
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);

  /* ---------- project mutations ---------- */
  function addProject() {
    const p = blankProject("Project " + (projects.length + 1), projects.length);
    setProjects((prev) => [...prev, p]);
    setCurrent(p.id);
    setRenamingProjectId(p.id);
    markSaved();
    actions.insertProject({ id: p.id, name: p.name, color: p.color, revenue: 0 }).catch(fail);
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
  function deleteProject(id: string) {
    if (projects.length <= 1) {
      alert("Keep at least one project.");
      return;
    }
    if (!curProj || !confirm(`Delete "${projects.find((p) => p.id === id)?.name}"? Its bookings will be freed.`)) return;
    setBookings((prev) => {
      const next = { ...prev };
      for (const k in next) if (next[k].proj === id) delete next[k];
      return next;
    });
    setProjects((prev) => {
      const rest = prev.filter((p) => p.id !== id);
      setCurrent(rest[0]?.id ?? "");
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
  function addPerson(r: Omit<Resource, "id">) {
    const p: Resource = { id: "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ...r };
    setRoster((prev) => [...prev, p]);
    markSaved();
    actions.insertResource(p).catch(fail);
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
  async function importBackup(s: { roster: Resource[]; projects: Project[]; bookings: BookingsMap; month?: string; current?: string }) {
    if (!confirm("This will REPLACE all data in the shared database with the contents of this file. Continue?")) return;
    try {
      await actions.bulkReplaceState({ month: s.month || month, roster: s.roster, projects: s.projects, current: s.current || current, bookings: s.bookings });
      const fresh = await actions.loadState();
      setRoster(fresh.roster);
      setProjects(fresh.projects);
      setBookings(fresh.bookings);
      setCurrent(fresh.projects[0]?.id ?? "");
      markSaved();
    } catch (e) {
      fail(e);
    }
  }

  const state = { month, roster, projects, current, bookings };

  return (
    <div className="wrap">
      <header className="top">
        <div className="brand">
          <h1>Resource Planner &amp; Project P&amp;L</h1>
          <p>Calendar bookings with OT and site/factory, double-booking guards, bench &amp; multi-month P&amp;L.</p>
        </div>
        <div className="row">
          <div>
            <span className="fldlabel">Planner month</span>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <span className={"save-dot" + (saved ? " show" : "")}>Saved ✓</span>
          <span className="badge b-day" style={{ textTransform: "capitalize" }}>
            {role}
          </span>
          <UserButton />
        </div>
      </header>

      <div className="tabs">
        {([
          ["plan", "Calendar planner"],
          ["pnl", "Activity/Scope P&L"],
          ["dash", "Portfolio dashboard"],
          ["bench", "Bench & utilisation"],
          ["daily", "Daily allocation (WhatsApp)"],
          ["roster", "Manage resources"],
          ["users", "Manage users"],
        ] as [Tab, string][])
          .filter(([id]) => canSee(id))
          .map(([id, label]) => (
            <button key={id} className={"tab" + (activeTab === id ? " active" : "")} onClick={() => setActiveTab(id)}>
              {label}
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
            renamingProjectId={renamingProjectId}
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
          />
        </section>
      )}

      {canSee("pnl") && (
        <section className={"panel" + (activeTab === "pnl" ? " active" : "")}>
          <Pnl
            state={state}
            onSetCurrent={setCurrent}
            onRename={renameProject}
            onDelete={deleteProject}
            onSetRevenue={setRevenue}
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
            onAddPerson={addPerson}
            onUploadExcel={uploadResourcesExcel}
            onUpdatePerson={updatePerson}
            onDeletePerson={deletePerson}
            onReset={resetRoster}
            onClearAll={clearRoster}
            onImport={importBackup}
          />
        </section>
      )}

      {isAdmin && (
        <section className={"panel" + (activeTab === "users" ? " active" : "")}>
          <Users currentUserId={currentUserId} />
        </section>
      )}
    </div>
  );
}
