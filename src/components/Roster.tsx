"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import type { AppState, BaselineSowRow, BookingsMap, Project, Resource, Unit } from "@/lib/types";
import { bkey } from "@/lib/types";
import { OT_HR_FRAC, countBand, countBandLoc, daysOfMonth, isSqft, monthLabel, otHoursDay, projStats } from "@/lib/calc";
import {
  createInstructionsUploadUrl,
  deleteInstructionsFile,
  finalizeInstructionsUpload,
  getInstructionsFile,
  type InstructionsFileRow,
} from "@/app/actions";

function r0(n: number) {
  return Math.round(Number(n) || 0);
}

export default function Roster({
  state,
  isAdmin,
  onAddPerson,
  onUploadExcel,
  onUpdatePerson,
  onDeletePerson,
  onReset,
  onClearAll,
  onImport,
  onUploadBaselineSow,
  onUpdateBaselineSowRow,
  onDeleteBaselineSowRow,
  onAddLeave,
  onDeleteLeave,
  onAddHoliday,
  onDeleteHoliday,
}: {
  state: AppState;
  isAdmin: boolean;
  onAddPerson: (r: Omit<Resource, "id">) => void;
  onUploadExcel: (rows: Omit<Resource, "id">[]) => void;
  onUpdatePerson: (id: string, patch: Partial<Resource>) => void;
  onDeletePerson: (id: string, name: string) => void;
  onReset: () => void;
  onClearAll: () => void;
  onImport: (s: { roster: Resource[]; projects: Project[]; bookings: BookingsMap; month?: string; current?: string }) => void;
  onUploadBaselineSow: (rows: Omit<BaselineSowRow, "id">[]) => void;
  onUpdateBaselineSowRow: (id: string, patch: Partial<BaselineSowRow>) => void;
  onDeleteBaselineSowRow: (id: string) => void;
  onAddLeave: (resourceId: string, startDate: string, endDate: string, reason: string) => void;
  onDeleteLeave: (id: string) => void;
  onAddHoliday: (date: string, label: string) => void;
  onDeleteHoliday: (id: string) => void;
}) {
  const { month, roster, projects, bookings, baselineSow, leaves, holidays } = state;
  // Display the library in execution sequence (Order of Work ascending) rather than upload
  // order — it reads as the actual build sequence that way. Order of Work is free text in the
  // sheet, so non-numeric/blank values sort last instead of poisoning the comparison; ties fall
  // back to SOW1/SOW2 so the order stays stable between renders.
  const baselineSowSorted = useMemo(() => {
    const ord = (s: string) => {
      const n = Number(String(s).trim());
      return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
    };
    return [...baselineSow].sort(
      (a, b) =>
        ord(a.orderOfWork) - ord(b.orderOfWork) ||
        a.sow1.localeCompare(b.sow1) ||
        a.sow2.localeCompare(b.sow2),
    );
  }, [baselineSow]);
  const [newName, setNewName] = useState("");
  const [newTrade, setNewTrade] = useState("");
  const [newUnit, setNewUnit] = useState<Unit>("day");
  const [newRate, setNewRate] = useState("");
  const [showRosterDetail, setShowRosterDetail] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const excelInput = useRef<HTMLInputElement>(null);
  const sowInput = useRef<HTMLInputElement>(null);
  const instructionsInput = useRef<HTMLInputElement>(null);
  const [instructionsFile, setInstructionsFile] = useState<InstructionsFileRow | null>(null);
  const [instructionsUploading, setInstructionsUploading] = useState(false);

  useEffect(() => {
    getInstructionsFile().then(setInstructionsFile).catch((err) => console.error(err));
  }, []);

  async function handleInstructionsUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setInstructionsUploading(true);
    try {
      const { signedUrl, path } = await createInstructionsUploadUrl(f.name, f.size);
      const res = await fetch(signedUrl, { method: "PUT", headers: { "Content-Type": f.type || "application/octet-stream" }, body: f });
      if (!res.ok) throw new Error(`Upload to storage failed (${res.status})`);
      await finalizeInstructionsUpload(path, f.name);
      setInstructionsFile(await getInstructionsFile());
    } catch (err) {
      alert("Upload failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setInstructionsUploading(false);
    }
  }

  async function handleDeleteInstructions() {
    if (!confirm("Delete the Instructions/calculation file?")) return;
    try {
      await deleteInstructionsFile();
      setInstructionsFile(null);
    } catch (err) {
      alert("Could not delete: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  const [leaveResId, setLeaveResId] = useState(roster[0]?.id || "");
  const [leaveStart, setLeaveStart] = useState("");
  const [leaveEnd, setLeaveEnd] = useState("");
  const [leaveReason, setLeaveReason] = useState("");
  const [holidayDate, setHolidayDate] = useState("");
  const [holidayLabel, setHolidayLabel] = useState("");

  function handleSowUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const buf = reader.result as ArrayBuffer;
        const wb = XLSX.read(buf, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        // Baseline SOW.xlsx has a merged title row ("Direct Project Costing") above the
        // real header row, so the header can't be assumed to be row 0 — scan for it instead.
        const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
        const headerRowIdx = rows.findIndex((r) => r.some((c) => norm(c) === "sow1"));
        if (headerRowIdx === -1) {
          alert('Could not find a header row containing "SOW1". Expected the same layout as Baseline SOW.xlsx.');
          return;
        }
        const header = rows[headerRowIdx].map(norm);
        const col = (aliases: string[]) => header.findIndex((h) => aliases.some((a) => h === a || h.includes(a)));
        const idx = {
          orderOfWork: col(["order of work"]),
          productName: col(["product name"]),
          sow1: col(["sow1"]),
          sow2: col(["sow2"]),
          dependencyScope: col(["dependency scope"]),
          dependentScope1: col(["dependent scope 1", "dependent scope"]),
          schedulerMethodology: col(["scheduler methodology"]),
          rateOfWork: col(["rate of work"]),
          uom: col(["uom"]),
          minLabour: col(["minimum lab", "min. labour", "min labour"]),
          phaseOfWork: col(["phase of work"]),
          trade1: col(["manpower1", "trade 1", "trade1"]),
          trade2: col(["manpower2", "trade 2", "trade2"]),
          material: col(["material"]),
          activityDescription: col(["activity description"]),
          dept: col(["dept", "department"]),
          areaOrCount: col(["area/count", "area / count"]),
          calculation: col(["calculation"]),
        };
        const at = (row: unknown[], i: number) => (i >= 0 ? row[i] : "");
        const parsed: Omit<BaselineSowRow, "id">[] = rows
          .slice(headerRowIdx + 1)
          .map((row) => ({
            orderOfWork: String(at(row, idx.orderOfWork) ?? "").trim(),
            productName: String(at(row, idx.productName) ?? "").trim(),
            sow1: String(at(row, idx.sow1) ?? "").trim(),
            sow2: String(at(row, idx.sow2) ?? "").trim(),
            dependencyScope: String(at(row, idx.dependencyScope) ?? "").trim(),
            dependentScope1: String(at(row, idx.dependentScope1) ?? "").trim(),
            schedulerMethodology: String(at(row, idx.schedulerMethodology) ?? "").trim(),
            rateOfWork: Number(at(row, idx.rateOfWork)) || 0,
            uom: String(at(row, idx.uom) ?? "").trim(),
            minLabour: Number(at(row, idx.minLabour)) || 0,
            phaseOfWork: String(at(row, idx.phaseOfWork) ?? "").trim(),
            trade1: String(at(row, idx.trade1) ?? "").trim(),
            trade2: String(at(row, idx.trade2) ?? "").trim(),
            material: String(at(row, idx.material) ?? "").trim(),
            activityDescription: String(at(row, idx.activityDescription) ?? "").trim(),
            dept: String(at(row, idx.dept) ?? "").trim(),
            areaOrCount: String(at(row, idx.areaOrCount) ?? "").trim(),
            calculation: String(at(row, idx.calculation) ?? "").trim(),
          }))
          .filter((r) => r.sow1);
        if (!parsed.length) {
          alert("No valid rows found. Expected columns like SOW1, SOW2, Rate of work/hr, UoM, Trade — same as Baseline SOW.xlsx.");
          return;
        }
        if (!confirm(`Replace the entire Baseline SOW library with these ${parsed.length} row(s)?`)) return;
        onUploadBaselineSow(parsed);
      } catch {
        alert("Could not read that Excel file.");
      }
    };
    reader.readAsArrayBuffer(f);
    e.target.value = "";
  }

  function handleAddLeave() {
    if (!leaveResId || !leaveStart || !leaveEnd) {
      alert("Pick a resource and a start/end date.");
      return;
    }
    if (leaveEnd < leaveStart) {
      alert("End date must be on or after the start date.");
      return;
    }
    onAddLeave(leaveResId, leaveStart, leaveEnd, leaveReason.trim());
    setLeaveStart("");
    setLeaveEnd("");
    setLeaveReason("");
  }

  function handleAddHoliday() {
    const label = holidayLabel.trim();
    if (!holidayDate || !label) {
      alert("Pick a date and enter a label.");
      return;
    }
    onAddHoliday(holidayDate, label);
    setHolidayDate("");
    setHolidayLabel("");
  }

  function addPerson() {
    const name = newName.trim();
    const trade = newTrade.trim();
    const rate = Number(newRate) || 0;
    if (!name) {
      alert("Enter a name.");
      return;
    }
    onAddPerson({ name, trade, unit: newUnit, rate });
    setNewName("");
    setNewTrade("");
    setNewRate("");
  }

  function handleExcelUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const buf = reader.result as ArrayBuffer;
        const wb = XLSX.read(buf, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

        // header matching is tolerant of the Manpower.xlsx format: padded headers like
        // " Employee Name " / " Trade " / " Total cost/day ", plus a trailing unlabeled
        // column holding "per day" / "per SQFT" for billing unit.
        const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
        const get = (row: Record<string, unknown>, aliases: string[]) => {
          for (const k of Object.keys(row)) {
            const nk = norm(k);
            if (aliases.some((a) => nk === a || nk.includes(a))) return row[k];
          }
          return undefined;
        };
        const detectUnitFromAnyColumn = (row: Record<string, unknown>): Unit | undefined => {
          for (const k of Object.keys(row)) {
            const v = norm(String(row[k] ?? ""));
            if (v.includes("sqft")) return "sqft";
            if (v.includes("per day")) return "day";
          }
          return undefined;
        };

        const parsed: Omit<Resource, "id">[] = rows
          .map((row) => {
            const name = String(get(row, ["employee name", "full name", "name"]) ?? "").trim();
            const trade = String(get(row, ["trade"]) ?? "").trim();
            const unitRaw = String(get(row, ["billing", "unit"]) ?? "").trim().toLowerCase();
            const unit: Unit = unitRaw.includes("sqft")
              ? "sqft"
              : unitRaw.includes("day")
                ? "day"
                : detectUnitFromAnyColumn(row) || "day";
            const rateRaw = get(row, ["total cost/day", "total cost per day", "rate"]);
            const rate = Number(rateRaw) || 0;
            const empId = String(get(row, ["emp id", "employee id"]) ?? "").trim() || undefined;
            const dept = String(get(row, ["dept", "department"]) ?? "").trim() || undefined;
            const payoutType = String(get(row, ["payout type"]) ?? "").trim() || undefined;
            const tradeCode = String(get(row, ["trade code"]) ?? "").trim() || undefined;
            const seniority = String(get(row, ["seniority"]) ?? "").trim() || undefined;
            const resourceCode = String(get(row, ["resource code"]) ?? "").trim() || undefined;
            return { name, trade, unit, rate, empId, dept, payoutType, tradeCode, seniority, resourceCode };
          })
          .filter((r) => r.name && r.rate > 0);

        if (!parsed.length) {
          alert(
            "No valid rows found. Expected columns like Employee Name, Trade, Total cost/day (rate), and a billing unit of per day / per SQFT. Rows missing a name or rate are skipped.",
          );
          return;
        }
        onUploadExcel(parsed);
      } catch {
        alert("Could not read that Excel file.");
      }
    };
    reader.readAsArrayBuffer(f);
    e.target.value = "";
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "resource_planner.json";
    a.click();
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const s = JSON.parse(String(r.result));
        if (!s.projects || !s.roster) {
          alert("Invalid file.");
          return;
        }
        onImport(s);
      } catch {
        alert("Invalid file.");
      }
    };
    r.readAsText(f);
    e.target.value = "";
  }

  function exportXlsx() {
    const wb = XLSX.utils.book_new();

    const pnlRows: (string | number)[][] = [
      ["Project", "Primary labour", "OT labour", "Sqft labour", "Material", "Total cost", "Revenue", "Profit", "Margin %"],
    ];
    let tP = 0,
      tO = 0,
      tS = 0,
      tM = 0,
      tR = 0;
    projects.forEach((pr) => {
      const s = projStats(state, pr);
      tP += s.prim;
      tO += s.ot;
      tS += s.sq;
      tM += s.mat;
      tR += s.rev;
      pnlRows.push([pr.name, r0(s.prim), r0(s.ot), r0(s.sq), r0(s.mat), r0(s.cost), r0(s.rev), r0(s.profit), s.rev > 0 ? +s.margin.toFixed(1) : ""]);
    });
    const cost = tP + tO + tS + tM;
    const profit = tR - cost;
    pnlRows.push(["PORTFOLIO TOTAL", r0(tP), r0(tO), r0(tS), r0(tM), r0(cost), r0(tR), r0(profit), tR > 0 ? +((profit / tR) * 100).toFixed(1) : ""]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(pnlRows), "Project P&L");

    const labRows: (string | number)[][] = [
      ["Project", "Name", "Trade", "Billing", "Rate", "Primary days", "OT hrs", "Site days", "Factory days", "Sqft", "Primary", "OT", "Sqft cost", "Total"],
    ];
    projects.forEach((pr) => {
      roster.forEach((p) => {
        const prim = countBand(state, p.id, pr.id, "P");
        const otHrs = (() => {
          let h = 0;
          const suf = "|" + p.id + "|O";
          for (const k in bookings) if (k.endsWith(suf) && bookings[k].proj === pr.id) h += bookings[k].hrs || 0;
          return h;
        })();
        const sqftArea = (pr.areas[p.id] || []).reduce((s, a) => s + (Number(a.sqft) || 0), 0);
        if (!prim && !otHrs && !sqftArea) return;
        const site = countBandLoc(state, p.id, pr.id, "P", "site");
        const fac = countBandLoc(state, p.id, pr.id, "P", "factory");
        let pc = 0,
          oc = 0,
          sc = 0;
        if (isSqft(p)) sc = sqftArea * p.rate;
        else {
          pc = prim * p.rate;
          oc = otHrs * p.rate * OT_HR_FRAC;
        }
        labRows.push([
          pr.name,
          p.name,
          p.trade,
          p.unit,
          p.rate,
          prim,
          otHrs,
          site,
          fac,
          isSqft(p) ? sqftArea : "",
          r0(pc),
          r0(oc),
          r0(sc),
          r0(pc + oc + sc),
        ]);
      });
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(labRows), "Labour detail");

    const matRows: (string | number)[][] = [["Project", "Item", "Cost"]];
    projects.forEach((pr) => {
      pr.materials.forEach((m) => {
        if (m.item || m.cost) matRows.push([pr.name, m.item || "", Number(m.cost) || 0]);
      });
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matRows), "Materials");

    const bdays = daysOfMonth(month).filter((d) => d.dow >= 1 && d.dow <= 6);
    const wd = bdays.length;
    const benchRows: (string | number)[][] = [[`Bench — ${monthLabel(month)} (${wd} working days, mon-sat)`], [], ["Name", "Trade", "Booked days", "Bench days", "OT hrs", "Utilisation %"]];
    roster.forEach((p) => {
      let bk = 0,
        ot = 0;
      bdays.forEach((d) => {
        if (bookings[bkey(d.date, p.id, "P")]) bk++;
        ot += otHoursDay(state, d.date, p.id);
      });
      benchRows.push([p.name, p.trade, bk, wd - bk, ot, wd ? +((bk / wd) * 100).toFixed(1) : 0]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(benchRows), "Bench " + month);

    const bkRows: (string | number)[][] = [["Date", "Resource", "Trade", "Band", "OT hrs", "Project", "Location"]];
    Object.keys(bookings)
      .sort()
      .forEach((k) => {
        const [date, resId, band] = k.split("|");
        const p = roster.find((x) => x.id === resId);
        const b = bookings[k];
        bkRows.push([date, p ? p.name : resId, p ? p.trade : "", band === "P" ? "Primary" : "OT", band === "O" ? b.hrs || 0 : "", projects.find((x) => x.id === b.proj)?.name || "?", b.loc]);
      });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(bkRows), "Bookings");

    XLSX.writeFile(wb, "Resource_Planner_" + month + ".xlsx");
  }

  return (
    <Fragment>
    <div className="card">
      <h2>Manage resources</h2>
      <div className="sub">Add or remove people. Edits persist and flow into the planner. Deleting clears their bookings.</div>
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="btn sm" onClick={() => setShowRosterDetail((v) => !v)}>
          {showRosterDetail ? "Hide" : "Show"} Manpower detail columns
        </button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="rtable">
          <thead>
            <tr>
              <th>Name</th>
              <th>Trade</th>
              <th className="narrow">Billing</th>
              <th className="narrow">Rate</th>
              {showRosterDetail && (
                <>
                  <th className="narrow">Emp ID</th>
                  <th>Dept</th>
                  <th className="narrow">Payout</th>
                  <th className="narrow">Trade code</th>
                  <th className="narrow">Seniority</th>
                  <th className="narrow">Resource code</th>
                </>
              )}
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {roster.map((p) => (
              <tr key={p.id}>
                <td>
                  <input type="text" value={p.name} onChange={(e) => onUpdatePerson(p.id, { name: e.target.value })} />
                </td>
                <td>
                  <input type="text" value={p.trade} onChange={(e) => onUpdatePerson(p.id, { trade: e.target.value })} />
                </td>
                <td className="narrow">
                  <select value={p.unit} onChange={(e) => onUpdatePerson(p.id, { unit: e.target.value as Unit })}>
                    <option value="day">Per day</option>
                    <option value="sqft">Per sqft</option>
                    <option value="lumpsum">Lumpsum</option>
                  </select>
                </td>
                <td className="narrow">
                  <input
                    type="number"
                    min={0}
                    value={p.rate}
                    onChange={(e) => onUpdatePerson(p.id, { rate: Number(e.target.value) || 0 })}
                  />
                </td>
                {showRosterDetail && (
                  <>
                    <td className="narrow muted" style={{ fontSize: 12 }}>{p.empId || ""}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{p.dept || ""}</td>
                    <td className="narrow muted" style={{ fontSize: 12 }}>{p.payoutType || ""}</td>
                    <td className="narrow muted" style={{ fontSize: 12 }}>{p.tradeCode || ""}</td>
                    <td className="narrow muted" style={{ fontSize: 12 }}>{p.seniority || ""}</td>
                    <td className="narrow muted" style={{ fontSize: 12 }}>{p.resourceCode || ""}</td>
                  </>
                )}
                <td>
                  <button className="del-x" onClick={() => onDeletePerson(p.id, p.name)}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="addrow">
        <div className="fld">
          <label>Name</label>
          <input type="text" placeholder="Full name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        </div>
        <div className="fld">
          <label>Trade</label>
          <input type="text" placeholder="e.g. Sn Carpenter" value={newTrade} onChange={(e) => setNewTrade(e.target.value)} />
        </div>
        <div className="fld">
          <label>Billing</label>
          <select value={newUnit} onChange={(e) => setNewUnit(e.target.value as Unit)}>
            <option value="day">Per day</option>
            <option value="sqft">Per sqft</option>
            <option value="lumpsum">Lumpsum</option>
          </select>
        </div>
        <div className="fld">
          <label>Rate</label>
          <input type="number" placeholder="0" min={0} value={newRate} onChange={(e) => setNewRate(e.target.value)} />
        </div>
        <button className="btn primary" onClick={addPerson}>
          Add
        </button>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn sm" onClick={() => excelInput.current?.click()}>
          Upload Excel
        </button>
        <input ref={excelInput} type="file" accept=".xlsx,.xls" hidden onChange={handleExcelUpload} />
        <button className="btn sm warn" onClick={onClearAll}>
          Clear all resources
        </button>
        <span className="muted" style={{ fontSize: 12 }}>
          Same format as Manpower.xlsx: Employee Name, Trade, Total cost/day (rate), and per day / per SQFT billing —
          also picks up Emp ID, Dept, Payout Type, Trade Code, Seniority and Resource Code when present (Manpower
          V2&apos;s columns), shown under &quot;Show Manpower detail columns&quot; above. Adds to the existing roster;
          rows without a name or rate are skipped — clear the roster first if re-uploading to avoid duplicates.
        </span>
      </div>
      <div className="row" style={{ marginTop: 18 }}>
        <button className="btn primary sm" onClick={exportXlsx}>
          Export to Excel
        </button>
        <button className="btn sm" onClick={exportJson}>
          Export all data (JSON)
        </button>
        <button className="btn sm" onClick={() => fileInput.current?.click()}>
          Import
        </button>
        <input ref={fileInput} type="file" accept="application/json" hidden onChange={handleImportFile} />
        <button className="btn sm warn spacer" onClick={onReset}>
          Reset to Manpower defaults
        </button>
      </div>
    </div>

    <div className="card">
      <h2>Baseline SOW</h2>
      <div className="sub">
        Admin-maintained rate-of-work reference library, matched by SOW1/SOW2 against uploaded Project SOW files to
        drive the scheduler on the Calendar planner tab. Sorted by Order of Work.
        {isAdmin && (
          <>
            {" "}
            Cells are editable and save as you type — but note a full re-upload replaces the whole library, so mirror
            any fix here in your master Excel too or the next upload will overwrite it.
          </>
        )}
      </div>
      {!baselineSow.length ? (
        <div className="empty">No Baseline SOW uploaded yet.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="rtable">
            <thead>
              <tr>
                <th className="narrow">Order</th>
                <th>Product name</th>
                <th>SOW1</th>
                <th>SOW2</th>
                <th className="narrow">Dep?</th>
                <th>Dependent scope 1</th>
                <th>Methodology</th>
                <th className="narrow">Rate/hr</th>
                <th className="narrow">UoM</th>
                <th className="narrow">MinLab</th>
                <th className="narrow">Phase</th>
                <th>Trade 1</th>
                <th>Trade 2</th>
                <th>Dept</th>
                <th>Material</th>
                <th>Activity description</th>
                <th className="narrow">Area/Count</th>
                <th>Calculation</th>
                {isAdmin && <th style={{ width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {baselineSowSorted.map((r) => {
                /* Admins edit the library in place; everyone else sees plain text. Scheduler
                   Methodology and Dependency scope are pickers rather than free text because
                   the scheduler branches on their exact values (see scheduler.ts) — a typo
                   there silently changes how days are computed. */
                const text = (field: keyof BaselineSowRow, extra?: React.CSSProperties) =>
                  isAdmin ? (
                    <input
                      type="text"
                      value={String(r[field] ?? "")}
                      style={extra}
                      onChange={(e) => onUpdateBaselineSowRow(r.id, { [field]: e.target.value } as Partial<BaselineSowRow>)}
                    />
                  ) : (
                    <>{String(r[field] ?? "")}</>
                  );
                const num = (field: "rateOfWork" | "minLabour") =>
                  isAdmin ? (
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={r[field] || ""}
                      onChange={(e) => onUpdateBaselineSowRow(r.id, { [field]: Number(e.target.value) || 0 })}
                    />
                  ) : (
                    <>{r[field] || ""}</>
                  );
                return (
                  <tr key={r.id}>
                    <td className="narrow">{text("orderOfWork")}</td>
                    <td>{text("productName")}</td>
                    <td>{text("sow1")}</td>
                    <td>{text("sow2")}</td>
                    <td className="narrow">
                      {isAdmin ? (
                        <select
                          value={r.dependencyScope.trim().toLowerCase() === "y" ? "y" : "n"}
                          onChange={(e) => onUpdateBaselineSowRow(r.id, { dependencyScope: e.target.value })}
                        >
                          <option value="n">n</option>
                          <option value="y">y</option>
                        </select>
                      ) : (
                        r.dependencyScope
                      )}
                    </td>
                    <td>{text("dependentScope1")}</td>
                    <td style={{ fontSize: 12 }}>
                      {isAdmin ? (
                        <select
                          value={r.schedulerMethodology}
                          onChange={(e) => onUpdateBaselineSowRow(r.id, { schedulerMethodology: e.target.value })}
                        >
                          {/* keep any legacy/unrecognised value selectable so editing one field
                              never silently rewrites another */}
                          {!["Rate of work/hr", "Activity/Item", "Manual", ""].includes(r.schedulerMethodology) && (
                            <option value={r.schedulerMethodology}>{r.schedulerMethodology}</option>
                          )}
                          <option value="">—</option>
                          <option value="Rate of work/hr">Rate of work/hr</option>
                          <option value="Activity/Item">Activity/Item</option>
                          <option value="Manual">Manual</option>
                        </select>
                      ) : (
                        r.schedulerMethodology
                      )}
                    </td>
                    <td className="narrow">{num("rateOfWork")}</td>
                    <td className="narrow">{text("uom")}</td>
                    <td className="narrow">{num("minLabour")}</td>
                    <td className="narrow">{text("phaseOfWork")}</td>
                    <td>{text("trade1")}</td>
                    <td>{text("trade2")}</td>
                    <td>{text("dept")}</td>
                    <td>{text("material")}</td>
                    <td style={{ fontSize: 12 }}>{text("activityDescription")}</td>
                    <td className="narrow">{text("areaOrCount")}</td>
                    <td style={{ fontSize: 12 }}>{text("calculation")}</td>
                    {isAdmin && (
                      <td>
                        <button className="del-x" onClick={() => onDeleteBaselineSowRow(r.id)}>
                          ×
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {isAdmin && (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn sm" onClick={() => sowInput.current?.click()}>
            Upload Baseline SOW
          </button>
          <input ref={sowInput} type="file" accept=".xlsx,.xls" hidden onChange={handleSowUpload} />
          <span className="muted" style={{ fontSize: 12 }}>
            Same format as Baseline SOW.xlsx. Replaces the entire library each time you upload.
          </span>
        </div>
      )}
    </div>

    <div className="card">
      <h2>Instructions / calculation file</h2>
      <div className="sub">
        Reference copy of the scheduler&apos;s computation rules (e.g. Instructions.xlsx). Stored for record-keeping
        only — the actual scheduling logic lives in code, not parsed from this file.
      </div>
      {!instructionsFile ? (
        <div className="empty">No Instructions file uploaded yet.</div>
      ) : (
        <div className="filerow">
          <span className="filename">{instructionsFile.fileName}</span>
          <span className="muted" style={{ fontSize: 11.5 }}>
            uploaded {new Date(instructionsFile.uploadedAt).toLocaleDateString()}
          </span>
          <a className="btn sm" href={instructionsFile.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
            Open file
          </a>
          {isAdmin && (
            <button className="del-x" style={{ fontSize: 14 }} onClick={handleDeleteInstructions}>
              ×
            </button>
          )}
        </div>
      )}
      {isAdmin && (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn sm" onClick={() => instructionsInput.current?.click()} disabled={instructionsUploading}>
            {instructionsUploading ? "Uploading…" : instructionsFile ? "Replace file" : "Upload Instructions file"}
          </button>
          <input ref={instructionsInput} type="file" accept=".xlsx,.xls,.pdf,.doc,.docx" hidden onChange={handleInstructionsUpload} />
        </div>
      )}
    </div>

    <div className="card">
      <h2>Resource leaves</h2>
      <div className="sub">Planned leave ranges block that resource&apos;s calendar cells on the Calendar planner tab.</div>
      {!leaves.length ? (
        <div className="empty">No planned leaves.</div>
      ) : (
        <table className="rtable">
          <thead>
            <tr>
              <th>Resource</th>
              <th className="narrow">From</th>
              <th className="narrow">To</th>
              <th>Reason</th>
              {isAdmin && <th style={{ width: 40 }} />}
            </tr>
          </thead>
          <tbody>
            {leaves.map((l) => (
              <tr key={l.id}>
                <td>{roster.find((p) => p.id === l.resourceId)?.name || l.resourceId}</td>
                <td className="narrow muted" style={{ fontSize: 12 }}>
                  {new Date(l.startDate).toLocaleDateString()}
                </td>
                <td className="narrow muted" style={{ fontSize: 12 }}>
                  {new Date(l.endDate).toLocaleDateString()}
                </td>
                <td style={{ fontSize: 12.5 }}>{l.reason}</td>
                {isAdmin && (
                  <td>
                    <button className="del-x" onClick={() => onDeleteLeave(l.id)}>
                      ×
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {isAdmin && (
        <div className="addrow" style={{ gridTemplateColumns: "1.3fr 1fr 1fr 1.3fr auto", marginTop: 12 }}>
          <div className="fld">
            <label>Resource</label>
            <select value={leaveResId} onChange={(e) => setLeaveResId(e.target.value)}>
              {roster.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="fld">
            <label>From</label>
            <input type="date" value={leaveStart} onChange={(e) => setLeaveStart(e.target.value)} />
          </div>
          <div className="fld">
            <label>To</label>
            <input type="date" value={leaveEnd} onChange={(e) => setLeaveEnd(e.target.value)} />
          </div>
          <div className="fld">
            <label>Reason</label>
            <input type="text" placeholder="Optional" value={leaveReason} onChange={(e) => setLeaveReason(e.target.value)} />
          </div>
          <button className="btn primary" onClick={handleAddLeave}>
            Add
          </button>
        </div>
      )}
    </div>

    <div className="card">
      <h2>Public holidays</h2>
      <div className="sub">Company-wide non-working dates, on top of the fixed weekly Sunday rule. Blocks calendar cells for everyone.</div>
      {!holidays.length ? (
        <div className="empty">No public holidays added.</div>
      ) : (
        <table className="rtable">
          <thead>
            <tr>
              <th className="narrow">Date</th>
              <th>Label</th>
              {isAdmin && <th style={{ width: 40 }} />}
            </tr>
          </thead>
          <tbody>
            {holidays.map((h) => (
              <tr key={h.id}>
                <td className="narrow muted" style={{ fontSize: 12 }}>
                  {new Date(h.date).toLocaleDateString()}
                </td>
                <td>{h.label}</td>
                {isAdmin && (
                  <td>
                    <button className="del-x" onClick={() => onDeleteHoliday(h.id)}>
                      ×
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {isAdmin && (
        <div className="addrow" style={{ gridTemplateColumns: "1fr 1.6fr auto", marginTop: 12 }}>
          <div className="fld">
            <label>Date</label>
            <input type="date" value={holidayDate} onChange={(e) => setHolidayDate(e.target.value)} />
          </div>
          <div className="fld">
            <label>Label</label>
            <input type="text" placeholder="e.g. Diwali" value={holidayLabel} onChange={(e) => setHolidayLabel(e.target.value)} />
          </div>
          <button className="btn primary" onClick={handleAddHoliday}>
            Add
          </button>
        </div>
      )}
    </div>
    </Fragment>
  );
}
