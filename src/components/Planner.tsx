"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import type { AppState, Band, Loc, ManualDuration, Project, ProjectSowItem, Resource, Unit } from "@/lib/types";
import { bkey } from "@/lib/types";
import { computeGantt, workingDaysInRange, type GanttRow } from "@/lib/scheduler";
import { getManualDurations, setManualDuration } from "@/app/actions";
import { daysInRange, daysOfMonth, hasPrimaryDay, holidayLabel, isLumpsum, isSqft, leaveReason, todayStr, unitLabel } from "@/lib/calc";
import Scheduler from "@/components/Scheduler";

const ALL_TRADES = "All";

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

export default function Planner({
  state,
  activeLoc,
  setActiveLoc,
  selection,
  readOnly,
  isAdmin,
  renamingProjectId,
  renamingParentId,
  onSelectParent,
  onAddParentProject,
  onRenameParent,
  onRenameParentDone,
  onSetProjectStartDate,
  onSetCurrent,
  onAddProject,
  onRename,
  onRenameDone,
  onSetPrimary,
  onClearPrimary,
  onCycleOt,
  onToggleSelect,
  onClearSelection,
  onMoveSelected,
  onUploadProjectSow,
  onClearSubProjects,
  onGenerateBookings,
  onSetMonth,
  onAddPerson,
  onEnsureSubProject,
}: {
  state: AppState;
  activeLoc: Loc;
  setActiveLoc: (l: Loc) => void;
  selection: Set<string>;
  readOnly: boolean;
  isAdmin: boolean;
  renamingProjectId: string | null;
  renamingParentId: string | null;
  onSelectParent: (id: string) => void;
  onAddParentProject: () => void;
  onRenameParent: (id: string, name: string) => void;
  onRenameParentDone: () => void;
  onSetProjectStartDate: (id: string, date: string) => void;
  onSetCurrent: (id: string) => void;
  onAddProject: () => void;
  onRename: (id: string, name: string) => void;
  onRenameDone: () => void;
  onSetPrimary: (date: string, resId: string) => void;
  onClearPrimary: (date: string, resId: string) => void;
  onCycleOt: (date: string, resId: string) => void;
  onToggleSelect: (key: string) => void;
  onClearSelection: () => void;
  onMoveSelected: (target: string) => void;
  onUploadProjectSow: (
    parentProjectId: string,
    items: Omit<ProjectSowItem, "id">[],
    startDate?: string,
  ) => Promise<{ created: number; updated: number }>;
  onClearSubProjects: (parentProjectId: string) => void;
  onGenerateBookings: (
    entries: { date: string; resourceId: string; projectId: string; loc: Loc }[],
  ) => Promise<{ inserted: number; skipped: number }>;
  onSetMonth: (month: string) => void;
  onAddPerson: (r: Omit<Resource, "id">) => Resource;
  onEnsureSubProject: (name: string, scopeKey?: string) => Project;
}) {
  const { month, roster, parentProjects, projects, currentParent, current, bookings } = state;
  const subProjects = useMemo(() => projects.filter((p) => p.parentProjectId === currentParent), [projects, currentParent]);
  const today = todayStr();
  const dragging = useRef(false);
  const dragMode = useRef<"add" | "remove">("add");
  const [showMove, setShowMove] = useState(false);
  const [moveTarget, setMoveTarget] = useState("");
  const [tradeFilter, setTradeFilter] = useState(ALL_TRADES);
  const curProj = projects.find((p) => p.id === current);
  const sowInputRef = useRef<HTMLInputElement>(null);
  const [sowUploading, setSowUploading] = useState(false);
  const [sowMode, setSowMode] = useState<"manual" | "upload">("manual");

  // The "Sub-scope (Trade)" button row doubles as the sub-project selector: picking one both
  // books against it (`current`) and filters the roster to the people who can actually work it.
  //
  // A sub-project is named after its Baseline SOW Dept (see uploadProjectSow in App.tsx), so
  // the mapping to people is Dept -> the trade1/trade2 values Baseline SOW lists for that Dept
  // -> roster members with those trades. Matching the roster's own Dept text directly is only a
  // secondary fallback: the two files' Dept vocabularies still differ in places (Baseline SOW
  // says "Painting" where Manpower says "Paint/Polish"), so trade text is the reliable link.
  /* The schedule is computed here rather than inside Scheduler because the Sub-scope (Trade)
     row below is derived from it too — some activities (Material Dispatch, the mandatory phase
     closers) are added by the scheduler's own dependency/mandatory logic and never exist as
     uploaded Project SOW rows, so they have no sub-project of their own. */
  const [manualDurations, setManualDurations] = useState<ManualDuration[]>([]);
  const subProjectIdsKey = subProjects.map((p) => p.id).join(",");
  useEffect(() => {
    if (!subProjects.length) {
      setManualDurations([]);
      return;
    }
    getManualDurations(subProjects.map((p) => p.id)).then(setManualDurations).catch((err) => console.error(err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subProjectIdsKey]);

  async function handleManualDaysChange(subProjectId: string, sow1: string, sow2: string, days: number) {
    try {
      await setManualDuration(subProjectId, sow1, sow2, days);
      setManualDurations((prev) => {
        const key = (m: ManualDuration) => m.subProjectId + "|" + m.sow1 + "|" + m.sow2;
        const target = key({ id: "", subProjectId, sow1, sow2, days });
        const existing = prev.find((m) => key(m) === target);
        if (existing) return prev.map((m) => (key(m) === target ? { ...m, days } : m));
        return [...prev, { id: target, subProjectId, sow1, sow2, days }];
      });
    } catch (err) {
      alert("Could not save: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  const projectStartDate = parentProjects.find((pp) => pp.id === currentParent)?.projectStartDate ?? null;
  const ganttResult = useMemo(() => {
    if (!projectStartDate || !subProjects.length) return null;
    return computeGantt(subProjects, state.baselineSow, state.holidays, projectStartDate, manualDurations, roster, state.leaves);
  }, [subProjects, state.baselineSow, state.holidays, projectStartDate, manualDurations, roster, state.leaves]);

  /* The booking grid spans the same continuous timeline as the scheduler above, so both read
     as one plan and neither needs month paging. Falls back to the selected month when there is
     no computed schedule yet (a manual project with no uploaded SOW). */
  const days = useMemo(() => {
    const dates = ganttResult?.dates ?? [];
    if (dates.length) return daysInRange(dates[0], dates[dates.length - 1]);
    return daysOfMonth(month);
  }, [ganttResult, month]);
  const usingScheduleSpan = !!ganttResult?.dates.length;

  /** Month bands above the day columns, matching the scheduler's. */
  const calMonthBands = useMemo(() => {
    const bands: { label: string; span: number }[] = [];
    days.forEach((d) => {
      const label = new Date(d.date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
      const last = bands[bands.length - 1];
      if (last && last.label === label) last.span++;
      else bands.push({ label, span: 1 });
    });
    return bands;
  }, [days]);

  /* An activity whose trade nobody on the roster carries (e.g. Material Dispatch needing
     "Transport") is work that gets contracted out. Give each one its own Sub-scope (Trade)
     chip, named by Product Name, so there's somewhere to hang the contract resource — these
     activities often ride along on another scope's sub-project (Material Dispatch inherits
     Modular Furniture's), so they'd otherwise have no chip of their own. Skipped when an
     existing sub-scope already carries that name, to avoid a duplicate chip. */
  const contractScopes = useMemo(() => {
    const existing = new Set(subProjects.map((p) => p.name.trim().toLowerCase()));
    const map = new Map<string, { name: string; trades: Set<string>; color: string }>();
    const add = (name: string, color: string, trades: string[]) => {
      const key = name.trim().toLowerCase();
      if (!key || existing.has(key)) return;
      if (!map.has(key)) map.set(key, { name: name.trim(), trades: new Set(), color });
      trades.forEach((t) => t.trim() && map.get(key)!.trades.add(t.trim().toLowerCase()));
    };
    (ganttResult?.rows ?? []).forEach((r) => {
      const name = (r.productName || r.sow1).trim();
      // Still unstaffed — needs contracting.
      if (r.unassignedTrades.length) add(name, r.subProjectColor, r.unassignedTrades);
      // Already contracted — keep the chip so the scope stays selectable and visible once the
      // ⚠ clears, rather than disappearing the moment it's staffed.
      const hired = roster.filter(
        (p) =>
          p.payoutType?.trim().toLowerCase() === "contract" &&
          p.dept?.trim().toLowerCase() === name.toLowerCase(),
      );
      if (hired.length) add(name, r.subProjectColor, hired.map((p) => p.trade));
    });
    return [...map.entries()].map(([key, v]) => ({ id: "contract:" + key, ...v }));
  }, [ganttResult, subProjects, roster]);

  const tradesForSubProject = useMemo(() => {
    const map = new Map<string, Set<string>>();
    state.baselineSow.forEach((b) => {
      const dept = b.dept.trim().toLowerCase();
      if (!dept) return;
      if (!map.has(dept)) map.set(dept, new Set());
      const set = map.get(dept)!;
      [b.trade1, b.trade2].forEach((t) => {
        const trade = t.trim().toLowerCase();
        if (trade) set.add(trade);
      });
    });
    return map;
  }, [state.baselineSow]);

  /* A contract resource is engaged for one scope and must not appear under any other, even when
     it nominally shares a trade. Baseline SOW uses "Vendor"/"Helper" as generic placeholders
     across many unrelated scopes, so trade text alone would put a countertop vendor in the
     appliance list and vice versa. In-house staff stay listed wherever their trade is needed. */
  const servesScope = (p: Resource, scopeName: string, scopeKey?: string) => {
    if (p.payoutType?.trim().toLowerCase() !== "contract") return true;
    // Pinned to one activity — only that scope lists it, regardless of shared display names.
    if (p.scopeKey) return p.scopeKey === scopeKey;
    if (scopeKey) return false;
    const hiredFor = p.dept?.trim().toLowerCase();
    if (!hiredFor) return true;
    return hiredFor === scopeName.trim().toLowerCase();
  };

  const rosterForSubProject = (proj: Project) => {
    const dept = proj.name.trim().toLowerCase();
    const trades = tradesForSubProject.get(dept) ?? new Set<string>();
    // An activity-scoped sub-scope lists exactly the contractors pinned to it — its trades come
    // from its own scheduler row, not from a Dept-wide trade set.
    if (proj.scopeKey) return roster.filter((p) => p.scopeKey === proj.scopeKey);
    return roster.filter(
      (p) =>
        (trades.has(p.trade.trim().toLowerCase()) || p.dept?.trim().toLowerCase() === dept) &&
        servesScope(p, proj.name, proj.scopeKey),
    );
  };

  const selectedContract = contractScopes.find((v) => v.id === tradeFilter) ?? null;
  const selectedSub = subProjects.find((p) => p.id === tradeFilter) ?? null;

  const visibleRoster = useMemo(() => {
    if (tradeFilter === ALL_TRADES) return roster;
    if (selectedContract) {
      return roster.filter(
        (p) =>
          (selectedContract.trades.has(p.trade.trim().toLowerCase()) ||
            p.dept?.trim().toLowerCase() === selectedContract.name.trim().toLowerCase()) &&
          servesScope(p, selectedContract.name),
      );
    }
    if (!selectedSub) return roster;
    return rosterForSubProject(selectedSub);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradeFilter, roster, selectedSub, selectedContract, tradesForSubProject]);

  /* Which trades a given sub-scope still has nobody for. Only these can be contracted out —
     offering a contractor for a trade that already has people would just create a competing
     assignment for the same activity. */
  const unassignedTradesFor = (scopeName: string, isContractScope: boolean) => {
    const rows = ganttResult?.rows ?? [];
    const key = scopeName.trim().toLowerCase();
    const out = new Set<string>();
    rows.forEach((r) => {
      const matches = isContractScope
        ? (r.productName || r.sow1).trim().toLowerCase() === key
        : r.subProjectId === selectedSub?.id;
      if (!matches) return;
      r.unassignedTrades.forEach((t) => out.add(t.trim()));
    });
    return [...out];
  };

  /* One shape for both kinds of selection, so the contract-resource flow below doesn't care
     whether the scope came from an uploaded SOW or from the scheduler's own logic. */
  const filteredScope =
    tradeFilter === ALL_TRADES
      ? null
      : selectedContract
        ? {
            name: selectedContract.name,
            trades: [...selectedContract.trades],
            unassigned: unassignedTradesFor(selectedContract.name, true),
          }
        : selectedSub
          ? {
              name: selectedSub.name,
              trades: [...(tradesForSubProject.get(selectedSub.name.trim().toLowerCase()) ?? [])],
              unassigned: unassignedTradesFor(selectedSub.name, false),
            }
          : null;
  const canContract = !!filteredScope?.unassigned.length;

  /* Contract-resource capture, scoped to one scheduler row. The gap is per-activity (two
     Baseline SOW rows both called "Counter Top" each need their own vendor), so the Assign
     action lives on the row that carries the ⚠ rather than on the Dept-level chip, which
     couldn't say which activity you meant. */
  const [assignRow, setAssignRow] = useState<GanttRow | null>(null);
  const [cName, setCName] = useState("");
  const [cTrade, setCTrade] = useState("");
  const [cUnit, setCUnit] = useState<Unit>("lumpsum");
  const [cRate, setCRate] = useState("");
  /** "" = give this activity its own sub-scope; otherwise the id of an existing sub-scope to
   *  fold it into, for when one vendor covers several activities and should bill as one line. */
  const [cMergeInto, setCMergeInto] = useState("");
  const [assigning, setAssigning] = useState(false);

  function openAssign(row: GanttRow) {
    setAssignRow(row);
    setCTrade(row.unassignedTrades[0] ?? "");
    setCName("");
    setCUnit("lumpsum");
    setCRate("");
    setCMergeInto("");
  }
  function closeAssign() {
    setAssignRow(null);
    setAssigning(false);
  }

  const assignValid = !!assignRow && cName.trim().length > 0 && cTrade.trim().length > 0 && Number(cRate) > 0;

  async function submitAssign() {
    if (!assignRow || !assignValid) return;
    setAssigning(true);
    const name = cName.trim();
    const trade = cTrade.trim();
    const rate = Number(cRate);
    const row = assignRow;

    /* Either fold into an existing sub-scope (one vendor, one COGS line, covering several
       activities) or give this activity its own — keyed by activityKey so two same-named
       scopes stay distinct entities even though they read identically on screen. */
    const merged = cMergeInto ? subProjects.find((p) => p.id === cMergeInto) ?? null : null;
    const scope = merged ?? onEnsureSubProject(row.productName || row.sow1, row.activityKey);

    const created = onAddPerson({
      name,
      trade,
      rate,
      unit: cUnit,
      dept: row.productName || row.sow1,
      payoutType: "Contract",
      // Pinned to this activity unless it's joining an existing Dept-level scope.
      scopeKey: merged && !merged.scopeKey ? undefined : merged?.scopeKey ?? row.activityKey,
    });

    const loc: Loc = row.dept.trim().toLowerCase() === "factory" ? "factory" : "site";
    const entries = workingDaysInRange(row.startDate, row.endDate, state.holidays).map((d) => ({
      date: d,
      resourceId: created.id,
      projectId: scope.id,
      loc,
    }));

    closeAssign();
    setTradeFilter(scope.id);
    try {
      const { inserted, skipped } = await onGenerateBookings(entries);
      alert(
        `${name} (${trade}) assigned to ${row.sow1} / ${row.sow2} — ${inserted} day(s) booked ` +
          `${row.startDate} → ${row.endDate}` +
          (skipped ? `, ${skipped} skipped (already booked elsewhere)` : "") +
          `. Costed under sub-scope "${scope.name}" on the Activity/Scope P&L.`,
      );
    } catch (err) {
      alert("Resource added, but booking its dates failed: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  function projColor(id: string) {
    return projects.find((p) => p.id === id)?.color || "#999";
  }

  /* Past-dated bookings can still be created/extended; removing one needs admin. */
  function isRemovalLocked(date: string) {
    return !isAdmin && date < today;
  }

  /* A public holiday or a resource's planned leave blocks the cell outright — no
     booking, regardless of project or role. Returns a tooltip string or null. */
  function blockedReason(date: string, resId: string) {
    const h = holidayLabel(state, date);
    if (h) return "Public holiday: " + h;
    const r = leaveReason(state, resId, date);
    if (r !== undefined) return r ? "On leave: " + r : "On leave";
    return null;
  }

  function primaryMouseDown(date: string, resId: string, shiftKey: boolean) {
    if (readOnly || blockedReason(date, resId)) return;
    const key = bkey(date, resId, "P");
    const b = bookings[key];
    if (b && b.proj !== current) return;
    if (shiftKey) {
      if (b && b.proj === current) onToggleSelect(key);
      return;
    }
    dragging.current = true;
    dragMode.current = b && b.proj === current ? "remove" : "add";
    applyPrimary(date, resId);
  }
  function applyPrimary(date: string, resId: string) {
    if (blockedReason(date, resId)) return;
    if (dragMode.current === "add") {
      onSetPrimary(date, resId);
    } else if (!isRemovalLocked(date)) {
      onClearPrimary(date, resId);
    }
  }
  function primaryMouseEnter(date: string, resId: string) {
    if (dragging.current) applyPrimary(date, resId);
  }

  function otMouseDown(date: string, resId: string, shiftKey: boolean) {
    if (readOnly || blockedReason(date, resId)) return;
    const key = bkey(date, resId, "O");
    const b = bookings[key];
    if (shiftKey) {
      if (b && b.hrs && b.proj === current) onToggleSelect(key);
      return;
    }
    if (b && b.hrs && b.proj !== current) return;
    const willRemove = b && b.hrs === 5; // next cycle step wraps 5 -> 0, deleting the OT booking
    if (willRemove && isRemovalLocked(date)) {
      alert("Removing a past-dated OT allocation needs an admin.");
      return;
    }
    onCycleOt(date, resId);
  }

  function excelSerialToISO(serial: number): string {
    const utcMs = Math.round((serial - 25569) * 86400 * 1000);
    return new Date(utcMs).toISOString().slice(0, 10);
  }

  function handleSowFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !currentParent) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const buf = reader.result as ArrayBuffer;
        const wb = XLSX.read(buf, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        // Project SOW.xlsx has a "Project execution Start date" title row above the real
        // header row, so locate it by scanning for a "SOW1" cell rather than assuming row 0.
        const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

        let startDate: string | undefined;
        const startRow = rows.find((r) => r.some((c) => norm(c).includes("project execution start date")));
        if (startRow) {
          const labelIdx = startRow.findIndex((c) => norm(c).includes("project execution start date"));
          const serial = Number(startRow[labelIdx + 1]);
          if (serial > 0) startDate = excelSerialToISO(serial);
        }

        const headerRowIdx = rows.findIndex((r) => r.some((c) => norm(c) === "sow1"));
        if (headerRowIdx === -1) {
          alert('Could not find a header row containing "SOW1". Expected the same layout as Project SOW.xlsx.');
          return;
        }
        const header = rows[headerRowIdx].map(norm);
        const col = (aliases: string[]) => header.findIndex((h) => aliases.some((a) => h === a || h.includes(a)));
        const idx = {
          area: col(["area"]),
          productName: col(["product name"]),
          sow1: col(["sow1"]),
          sow2: col(["sow2"]),
          width: col(["width"]),
          height: col(["height"]),
          depth: col(["depth"]),
          sqft: col(["sqft"]),
          phase: col(["phase"]),
        };
        const at = (row: unknown[], i: number) => (i >= 0 ? row[i] : "");
        let lastArea = "";
        const items: Omit<ProjectSowItem, "id">[] = rows
          .slice(headerRowIdx + 1)
          .map((row) => {
            const areaCell = String(at(row, idx.area) ?? "").trim();
            if (areaCell) lastArea = areaCell;
            return {
              area: lastArea,
              productName: String(at(row, idx.productName) ?? "").trim(),
              sow1: String(at(row, idx.sow1) ?? "").trim(),
              sow2: String(at(row, idx.sow2) ?? "").trim(),
              width: Number(at(row, idx.width)) || 0,
              height: Number(at(row, idx.height)) || 0,
              depth: Number(at(row, idx.depth)) || 0,
              sqft: Number(at(row, idx.sqft)) || 0,
              phase: String(at(row, idx.phase) ?? "").trim(),
            };
          })
          .filter((r) => r.sow1);
        if (!items.length) {
          alert("No valid rows found. Expected columns like SOW1, SOW2, Width, Height, Sqft — same as Project SOW.xlsx.");
          return;
        }
        const deptByKey = new Map<string, string>();
        state.baselineSow.forEach((b) => {
          const key = b.sow1.trim().toLowerCase() + "|" + b.sow2.trim().toLowerCase();
          if (!deptByKey.has(key)) deptByKey.set(key, b.dept.trim());
        });
        const groupNames = [
          ...new Set(
            items.map((r) => deptByKey.get(r.sow1.trim().toLowerCase() + "|" + r.sow2.trim().toLowerCase()) || r.sow1),
          ),
        ];
        if (
          !confirm(
            `Found ${items.length} scope row(s) grouped into ${groupNames.length} sub-project(s) by Dept: ${groupNames.join(", ")}.\n\n` +
              `New groups become new sub-projects; groups matching an existing sub-project name keep that sub-project but replace its uploaded rows. Continue?`,
          )
        )
          return;
        setSowUploading(true);
        onUploadProjectSow(currentParent, items, startDate)
          .then(({ created, updated }) => {
            alert(`Done — created ${created} new sub-project(s), updated ${updated} existing one(s).`);
          })
          .catch((err) => alert("Upload failed: " + (err instanceof Error ? err.message : String(err))))
          .finally(() => setSowUploading(false));
      } catch {
        alert("Could not read that Excel file.");
      }
    };
    reader.readAsArrayBuffer(f);
  }

  function openMoveModal() {
    const others = projects.filter((p) => p.id !== current);
    if (!others.length) {
      alert("Create another project first.");
      return;
    }
    setMoveTarget(others[0].id);
    setShowMove(true);
  }

  return (
    <div className="card" onMouseUp={() => (dragging.current = false)}>
      <div className="planner-toolbar">
        {!readOnly && (
          <button className="btn sm" onClick={onAddParentProject}>
            + Create project
          </button>
        )}
        <div>
          <span className="fldlabel">Project</span>
          {renamingParentId ? (
            <input
              autoFocus
              type="text"
              defaultValue={parentProjects.find((pp) => pp.id === renamingParentId)?.name}
              style={{ minWidth: 200, padding: "8px 10px", border: "1px solid var(--line-strong)", borderRadius: 8 }}
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onRenameParent(renamingParentId, e.currentTarget.value.trim() || "Project");
                  onRenameParentDone();
                } else if (e.key === "Escape") {
                  onRenameParentDone();
                }
              }}
              onBlur={(e) => {
                onRenameParent(renamingParentId, e.target.value.trim() || "Project");
                onRenameParentDone();
              }}
            />
          ) : (
            <select style={{ minWidth: 200 }} value={currentParent} onChange={(e) => onSelectParent(e.target.value)}>
              {parentProjects.map((pp) => (
                <option key={pp.id} value={pp.id}>
                  {pp.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <span style={{ width: 1, height: 22, background: "var(--line)" }} />
        <span className="fldlabel" style={{ margin: 0 }}>
          Book at
        </span>
        <div className="seg">
          <button className={activeLoc === "site" ? "on" : ""} onClick={() => setActiveLoc("site")}>
            Site
          </button>
          <button className={activeLoc === "factory" ? "on" : ""} onClick={() => setActiveLoc("factory")}>
            Factory
          </button>
        </div>
        <div className="spacer" />
        {!readOnly && selection.size > 0 && (
          <>
            <span className="selinfo">{selection.size} cell(s) selected</span>
            <button className="btn sm" onClick={openMoveModal}>
              Move selected →
            </button>
            <button className="btn sm" onClick={onClearSelection}>
              Clear
            </button>
          </>
        )}
      </div>

      {currentParent && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="fldlabel" style={{ marginBottom: 8 }}>
            Sub-scope setup — {parentProjects.find((pp) => pp.id === currentParent)?.name}
          </div>
          {!readOnly && (
            <div className="row" style={{ marginBottom: 12 }}>
              <label className="radiolbl">
                <input type="radio" name="sowmode" checked={sowMode === "manual"} onChange={() => setSowMode("manual")} />
                Manual config
              </label>
              <label className="radiolbl">
                <input type="radio" name="sowmode" checked={sowMode === "upload"} onChange={() => setSowMode("upload")} />
                Upload SOW
              </label>
            </div>
          )}
          {!readOnly && sowMode === "manual" && (
            <button className="btn sm" onClick={onAddProject}>
              + New sub-project
            </button>
          )}
          {!readOnly && sowMode === "upload" && (
            <div className="row" style={{ gap: 10 }}>
              <button className="btn sm" onClick={() => sowInputRef.current?.click()} disabled={sowUploading}>
                {sowUploading ? "Uploading…" : "Upload project SOW.xlsx"}
              </button>
              <button
                className="btn sm"
                onClick={() => onClearSubProjects(currentParent)}
                disabled={sowUploading || !subProjects.length}
                title="Delete all sub-projects (and their SOW items/bookings) for this project before re-uploading, so re-uploads don't pile up duplicates"
              >
                Clear Table Contents
              </button>
              <span className="muted" style={{ fontSize: 12 }}>
                Matched against the Baseline SOW library admins maintain on Manage resources. Use &quot;Clear Table
                Contents&quot; first if you&apos;re re-uploading the same file to avoid duplicate sub-projects.
              </span>
            </div>
          )}
          <input ref={sowInputRef} type="file" accept=".xlsx,.xls" hidden onChange={handleSowFile} />

          <Scheduler
            subProjects={subProjects}
            baselineSow={state.baselineSow}
            holidays={state.holidays}
            roster={roster}
            leaves={state.leaves}
            projectStartDate={projectStartDate}
            onSetProjectStartDate={(date) => onSetProjectStartDate(currentParent, date)}
            readOnly={readOnly}
            onGenerateBookings={onGenerateBookings}
            result={ganttResult}
            onAssign={openAssign}
            onManualDaysChange={handleManualDaysChange}
          />

          {/* With a computed schedule both grids span the whole project and scroll, so a month
              picker would do nothing. It only matters for a manual project with no uploaded SOW,
              where the booking grid has no timeline to follow and falls back to one month. */}
          {!usingScheduleSpan && (
            <div className="row" style={{ marginTop: 14, alignItems: "center" }}>
              <div>
                <span className="fldlabel">Calendar month</span>
                <div className="row" style={{ gap: 4 }}>
                  <button className="btn sm" onClick={() => onSetMonth(shiftMonth(month, -1))} title="Previous month">
                    ←
                  </button>
                  <input type="month" value={month} onChange={(e) => onSetMonth(e.target.value)} />
                  <button className="btn sm" onClick={() => onSetMonth(shiftMonth(month, 1))} title="Next month">
                    →
                  </button>
                </div>
              </div>
              <span className="muted" style={{ fontSize: 12 }}>
                No computed schedule yet — the booking calendar below shows one month at a time.
              </span>
            </div>
          )}
          {usingScheduleSpan && (
            <div className="muted" style={{ fontSize: 12, marginTop: 14 }}>
              Booking calendar below spans the full project ({days[0].date} → {days[days.length - 1].date}) — scroll
              sideways; the resource column stays pinned.
            </div>
          )}

          {!subProjects.length && (
            <div className="muted" style={{ fontSize: 12.5, marginTop: 14 }}>
              No sub-scopes yet — use Manual config or upload a SOW file above to create the first one.
            </div>
          )}
        </div>
      )}

      <div className="legend" style={{ marginBottom: 12 }}>
        <span className="fldlabel" style={{ margin: 0 }}>
          Sub-scope (Trade)
        </span>
        <button className={"legchip" + (tradeFilter === ALL_TRADES ? " active" : "")} onClick={() => setTradeFilter(ALL_TRADES)}>
          All
        </button>
        {subProjects.map((p) =>
          renamingProjectId === p.id ? (
            <input
              key={p.id}
              autoFocus
              type="text"
              defaultValue={p.name}
              style={{ minWidth: 120, padding: "4px 8px", border: "1px solid var(--line-strong)", borderRadius: 8 }}
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onRename(p.id, e.currentTarget.value.trim() || "Sub-project");
                  onRenameDone();
                } else if (e.key === "Escape") {
                  onRenameDone();
                }
              }}
              onBlur={(e) => {
                onRename(p.id, e.target.value.trim() || "Sub-project");
                onRenameDone();
              }}
            />
          ) : (
            <Fragment key={p.id}>
              <button
                className={"legchip" + (tradeFilter === p.id || current === p.id ? " active" : "")}
                onClick={() => {
                  onSetCurrent(p.id);
                  setTradeFilter(p.id);
                }}
              >
                <span className="sw" style={{ background: p.color }} />
                {p.name}
                {/* Two sub-scopes may legitimately share a display name (Baseline SOW has two
                    "Counter Top" activities). They're distinct entities keyed by scopeKey — show
                    the SOW2 underneath so they read apart on screen. */}
                {p.scopeKey && (
                  <span className="muted" style={{ fontSize: 10, marginLeft: 6, opacity: 0.75 }}>
                    {p.scopeKey.split("|")[1] || p.scopeKey.split("|")[0]}
                  </span>
                )}
              </button>
            </Fragment>
          ),
        )}
        {/* Scheduler-derived scopes (Material Dispatch and friends) sit alongside the uploaded
            ones — dashed border marks them as generated rather than from a Project SOW. They
            can't be booked against directly, so selecting one only filters the roster. */}
        {contractScopes.map((v) => (
          <Fragment key={v.id}>
            <button
              className={"legchip" + (tradeFilter === v.id ? " active" : "")}
              style={{ borderStyle: "dashed" }}
              title={`Scheduler-generated scope — trades: ${[...v.trades].join(", ") || "none"}`}
              onClick={() => setTradeFilter(tradeFilter === v.id ? ALL_TRADES : v.id)}
            >
              <span className="sw" style={{ background: v.color }} />
              {v.name}
            </button>
          </Fragment>
        ))}
        {!subProjects.length && !contractScopes.length && (
          <span className="muted" style={{ fontSize: 12.5 }}>No sub-scopes yet.</span>
        )}
      </div>
      {filteredScope && (
        <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
          {canContract
            ? `${filteredScope.name} still needs ${filteredScope.unassigned.join(", ")} — use Assign on the matching scheduler row above to contract it.`
            : `${filteredScope.name} is fully staffed — showing ${visibleRoster.length} resource(s)${filteredScope.trades.length ? " for " + filteredScope.trades.join(", ") : ""}.`}
        </div>
      )}
      <div className="hint">
        Each resource has a <b>Primary</b> row (10am–6pm, 8h) and an <b>OT</b> row (from 6pm, 1-hour blocks). Pick the
        active project (legend) and Site/Factory, then <b>click-drag</b> the primary row to book; click a booked day
        to unbook. On the OT row, <b>click a day to add OT hours</b> (cycles 0→5); OT needs a primary that day (can be
        a different project). Cells owned by other projects are blocked. Red-hatched cells are a public holiday or a
        resource&apos;s planned leave (hover for detail) and can&apos;t be booked at all. <b>F</b> marks factory.
        Shift-click your cells to select them, then Move.
      </div>
      <div className="planner-wrap">
        <table className="cal">
          <thead>
            {/* Month band, so a full-project scroll stays orientated — same idea as the
                scheduler's, and only worth showing once the grid spans more than one month. */}
            {calMonthBands.length > 1 && (
              <tr>
                <th className="namecol" />
                {calMonthBands.map((b, i) => (
                  <th
                    key={b.label}
                    colSpan={b.span}
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      background: "#faf9f6",
                      borderLeft: i ? "2px solid var(--line-strong)" : undefined,
                    }}
                  >
                    {b.label}
                  </th>
                ))}
                <th className="rowtot" style={{ background: "#faf9f6" }} />
              </tr>
            )}
            <tr>
              <th className="namecol">Resource</th>
              {days.map((d) => (
                <th key={d.date} className={d.dow === 0 || d.dow === 6 ? "wknd" : ""}>
                  <div className="dow">{d.dowLbl}</div>
                  <div className="daynum">{d.d}</div>
                </th>
              ))}
              <th className="rowtot" style={{ background: "#faf9f6" }}>
                Days
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRoster.map((p) => {
              let mine = 0;
              let rowh = 0;
              const primaryCells = days.map((d) => {
                const key = bkey(d.date, p.id, "P");
                const b = bookings[key];
                const blocked = blockedReason(d.date, p.id);
                let cls = "cell";
                if (d.dow === 0 || d.dow === 6) cls += " wknd";
                if (d.date === today) cls += " today";
                let style: React.CSSProperties = {};
                if (blocked) cls += " blocked";
                if (b) {
                  if (b.proj === current) {
                    cls += " mine";
                    mine++;
                    if (selection.has(key)) cls += " sel";
                    if (isRemovalLocked(d.date)) cls += " locked";
                  } else cls += " other";
                  if (b.loc === "factory") cls += " fac";
                  style = { "--_pc": projColor(b.proj) } as React.CSSProperties;
                }
                return (
                  <td
                    key={d.date}
                    className={cls}
                    style={style}
                    title={blocked || undefined}
                    onMouseDown={(e) => {
                      primaryMouseDown(d.date, p.id, e.shiftKey);
                      e.preventDefault();
                    }}
                    onMouseEnter={() => primaryMouseEnter(d.date, p.id)}
                  />
                );
              });
              const otCells = days.map((d) => {
                const key = bkey(d.date, p.id, "O");
                const b = bookings[key];
                const blocked = blockedReason(d.date, p.id);
                let cls = "cell otcell";
                if (d.dow === 0 || d.dow === 6) cls += " wknd";
                if (d.date === today) cls += " today";
                const primHere = hasPrimaryDay(state, d.date, p.id);
                if (!primHere) cls += " noprim";
                if (blocked) cls += " blocked";
                let style: React.CSSProperties = {};
                let inner: React.ReactNode = null;
                if (b && b.hrs) {
                  if (b.proj === current) {
                    cls += " mine";
                    if (selection.has(key)) cls += " sel";
                  } else cls += " other";
                  if (b.loc === "factory") cls += " fac";
                  style = { "--_pc": projColor(b.proj) } as React.CSSProperties;
                  inner = <span className="othr">{b.hrs}</span>;
                  rowh += b.hrs;
                }
                return (
                  <td
                    key={d.date}
                    className={cls}
                    style={style}
                    title={blocked || undefined}
                    onMouseDown={(e) => {
                      otMouseDown(d.date, p.id, e.shiftKey);
                      e.preventDefault();
                    }}
                  >
                    {inner}
                  </td>
                );
              });
              return (
                <Fragment key={p.id}>
                  <tr>
                    <td className="namecol">
                      <div className="nm">
                        {p.name}
                        <span className={"badge " + (isSqft(p) ? "b-sqft" : isLumpsum(p) ? "b-lump" : "b-day")}>
                          {unitLabel(p)}
                        </span>
                      </div>
                      <div className="tr">
                        {p.trade} <span className="rowtag prim">Primary</span>
                      </div>
                    </td>
                    {primaryCells}
                    <td className="rowtot">{mine || ""}</td>
                  </tr>
                  <tr className="otrow">
                    <td className="namecol ot">
                      <div className="tr" style={{ paddingLeft: 2 }}>
                        <span className="rowtag ot">OT (hrs)</span>
                      </div>
                    </td>
                    {otCells}
                    <td className="rowtot">{rowh ? rowh + "h" : ""}</td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className={"modal-bg" + (assignRow ? " show" : "")}>
        <div className="modal" style={{ maxWidth: 520 }}>
          <h3>Assign a contract resource</h3>
          {assignRow && (
            <>
              <p style={{ marginTop: 0 }}>
                <b>
                  {assignRow.sow1} / {assignRow.sow2}
                </b>
                <br />
                <span className="muted" style={{ fontSize: 12 }}>
                  {assignRow.productName} · {assignRow.area || "—"} · scheduled {assignRow.startDate} → {assignRow.endDate}
                </span>
              </p>
              <div className="fld">
                <label>Resource name</label>
                <input
                  autoFocus
                  type="text"
                  value={cName}
                  placeholder="e.g. Rakesh Stoneworks"
                  onChange={(e) => setCName(e.target.value)}
                />
              </div>
              <div className="fld">
                <label>Trade to fill</label>
                {assignRow.unassignedTrades.length > 1 ? (
                  <select value={cTrade} onChange={(e) => setCTrade(e.target.value)}>
                    {assignRow.unassignedTrades.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input type="text" value={cTrade} readOnly style={{ background: "var(--line)" }} />
                )}
              </div>
              <div className="fld">
                <label>Basis</label>
                <select value={cUnit} onChange={(e) => setCUnit(e.target.value as Unit)}>
                  <option value="lumpsum">Lumpsum</option>
                  <option value="sqft">Rate / sqft</option>
                  <option value="day">Rate / day</option>
                </select>
              </div>
              <div className="fld">
                <label>{cUnit === "lumpsum" ? "Lumpsum amount" : cUnit === "sqft" ? "Rate per sqft" : "Rate per day"}</label>
                <input type="number" min={0} value={cRate} placeholder="0" onChange={(e) => setCRate(e.target.value)} />
              </div>
              <div className="fld">
                <label>Cost this against</label>
                <select value={cMergeInto} onChange={(e) => setCMergeInto(e.target.value)}>
                  <option value="">Its own sub-scope — {assignRow.productName || assignRow.sow1}</option>
                  {subProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      Merge into: {p.name}
                      {p.scopeKey ? ` (${p.scopeKey.split("|")[1]})` : ""}
                    </option>
                  ))}
                </select>
                <span className="muted" style={{ fontSize: 11.5 }}>
                  Merge when one vendor covers several activities and should bill as a single P&amp;L line.
                </span>
              </div>
              <div className="row">
                <button className="btn" onClick={closeAssign} disabled={assigning}>
                  Cancel
                </button>
                <button className="btn primary" onClick={submitAssign} disabled={!assignValid || assigning}>
                  {assigning ? "Assigning…" : "Submit"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className={"modal-bg" + (showMove ? " show" : "")}>
        <div className="modal">
          <h3>Move booked days to another project</h3>
          <p>
            {selection.size} selected cell(s) will leave &quot;{curProj?.name}&quot; and move to the chosen project.
            Location (site/factory) is preserved. Cells already taken on the target are skipped.
          </p>
          <div className="fld">
            <label>Target project</label>
            <select value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)}>
              {projects
                .filter((p) => p.id !== current)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="row">
            <button className="btn" onClick={() => setShowMove(false)}>
              Cancel
            </button>
            <button
              className="btn primary"
              onClick={() => {
                onMoveSelected(moveTarget);
                setShowMove(false);
              }}
            >
              Move days
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
