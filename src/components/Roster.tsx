"use client";

import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import type { AppState, BookingsMap, Project, Resource, Unit } from "@/lib/types";
import { bkey } from "@/lib/types";
import { OT_HR_FRAC, countBand, countBandLoc, daysOfMonth, isSqft, monthLabel, otHoursDay, projStats } from "@/lib/calc";

function r0(n: number) {
  return Math.round(Number(n) || 0);
}

export default function Roster({
  state,
  onAddPerson,
  onUpdatePerson,
  onDeletePerson,
  onReset,
  onImport,
}: {
  state: AppState;
  onAddPerson: (r: Omit<Resource, "id">) => void;
  onUpdatePerson: (id: string, patch: Partial<Resource>) => void;
  onDeletePerson: (id: string, name: string) => void;
  onReset: () => void;
  onImport: (s: { roster: Resource[]; projects: Project[]; bookings: BookingsMap; month?: string; current?: string }) => void;
}) {
  const { month, roster, projects, bookings } = state;
  const [newName, setNewName] = useState("");
  const [newTrade, setNewTrade] = useState("");
  const [newUnit, setNewUnit] = useState<Unit>("day");
  const [newRate, setNewRate] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

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
    <div className="card">
      <h2>Manage resources</h2>
      <div className="sub">Add or remove people. Edits persist and flow into the planner. Deleting clears their bookings.</div>
      <div style={{ overflowX: "auto" }}>
        <table className="rtable">
          <thead>
            <tr>
              <th>Name</th>
              <th>Trade</th>
              <th className="narrow">Billing</th>
              <th className="narrow">Rate</th>
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
  );
}
