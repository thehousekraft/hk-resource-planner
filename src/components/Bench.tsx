"use client";

import { useState } from "react";
import type { AppState } from "@/lib/types";
import { NUM, daysOfMonth, monthLabel, otHoursDay } from "@/lib/calc";
import { bkey } from "@/lib/types";

type WdMode = "mon-sat" | "mon-fri" | "all";

function isWorkingDay(mode: WdMode, dow: number) {
  if (mode === "all") return true;
  if (mode === "mon-fri") return dow >= 1 && dow <= 5;
  return dow >= 1 && dow <= 6;
}

export default function Bench({ state }: { state: AppState }) {
  const [wdMode, setWdMode] = useState<WdMode>("mon-sat");
  const { month, roster, bookings } = state;
  const days = daysOfMonth(month).filter((d) => isWorkingDay(wdMode, d.dow));
  const wdCount = days.length;

  let totBench = 0,
    totBooked = 0,
    fullyIdle = 0;
  const rows = roster
    .map((p) => {
      let booked = 0,
        ot = 0;
      days.forEach((d) => {
        if (bookings[bkey(d.date, p.id, "P")]) booked++;
        ot += otHoursDay(state, d.date, p.id);
      });
      const bench = wdCount - booked;
      totBench += bench;
      totBooked += booked;
      if (booked === 0) fullyIdle++;
      return { p, booked, bench, ot, util: wdCount ? (booked / wdCount) * 100 : 0 };
    })
    .sort((a, b) => a.util - b.util);

  const cap = roster.length * wdCount;
  const blended = cap ? (totBooked / cap) * 100 : 0;

  return (
    <div className="card">
      <h2>
        Bench &amp; utilisation <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>(selected month)</span>
      </h2>
      <div className="sub">
        {monthLabel(month)} · {wdCount} working day(s)
      </div>
      <div className="sumstrip" style={{ marginBottom: 22 }}>
        <div className="cell2">
          <div className="k">Resources</div>
          <div className="v">{roster.length}</div>
        </div>
        <div className="cell2">
          <div className="k">Capacity (mandays)</div>
          <div className="v">{cap}</div>
        </div>
        <div className="cell2">
          <div className="k">Booked mandays</div>
          <div className="v">{totBooked}</div>
        </div>
        <div className="cell2">
          <div className="k">Bench mandays</div>
          <div className={"v " + (totBench > 0 ? "neg" : "pos")}>{totBench}</div>
        </div>
        <div className="cell2">
          <div className="k">Fully idle people</div>
          <div className={"v " + (fullyIdle > 0 ? "neg" : "pos")}>{fullyIdle}</div>
        </div>
        <div className="cell2">
          <div className="k">Utilisation</div>
          <div className={"v " + (blended >= 60 ? "pos" : "neg")}>{NUM.format(blended)}%</div>
        </div>
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="fldlabel" style={{ margin: 0 }}>
          Working days count
        </span>
        <div className="seg">
          <button className={wdMode === "mon-sat" ? "on" : ""} onClick={() => setWdMode("mon-sat")}>
            Mon–Sat
          </button>
          <button className={wdMode === "mon-fri" ? "on" : ""} onClick={() => setWdMode("mon-fri")}>
            Mon–Fri
          </button>
          <button className={wdMode === "all" ? "on" : ""} onClick={() => setWdMode("all")}>
            All days
          </button>
        </div>
        <span className="muted" style={{ fontSize: 12 }}>
          Bench = working days with no primary booking anywhere.
        </span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="dash-table">
          <thead>
            <tr>
              <th>Resource</th>
              <th>Trade</th>
              <th>Booked days</th>
              <th>Bench days</th>
              <th>OT hrs</th>
              <th>Utilisation</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, booked, bench, ot, util }) => {
              const col = util >= 75 ? "var(--accent)" : util >= 40 ? "#8a6d1f" : "var(--warn)";
              return (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="muted">{p.trade}</td>
                  <td>{booked}</td>
                  <td style={{ fontWeight: bench === wdCount ? 700 : 400, color: bench === wdCount ? "var(--warn)" : "inherit" }}>
                    {bench}
                  </td>
                  <td>{ot ? ot + "h" : ""}</td>
                  <td>
                    <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
                      <span>{NUM.format(util)}%</span>
                      <div className="util-bar">
                        <i style={{ width: Math.min(100, util) + "%", background: col }} />
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
