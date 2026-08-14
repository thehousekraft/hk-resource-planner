"use client";

import { useMemo, useState } from "react";
import type { AppState } from "@/lib/types";
import { NUM, PALETTE, daysInRange, daysOfMonth, holidayLabel, leaveReason, monthLabel, otHoursDay, todayStr } from "@/lib/calc";
import { bkey } from "@/lib/types";

type WdMode = "mon-sat" | "mon-fri" | "all";

function isWorkingDay(mode: WdMode, dow: number) {
  if (mode === "all") return true;
  if (mode === "mon-fri") return dow >= 1 && dow <= 5;
  return dow >= 1 && dow <= 6;
}

export default function Bench({
  state,
  isAdmin,
  onAddLeave,
  onDeleteLeave,
}: {
  state: AppState;
  isAdmin: boolean;
  onAddLeave: (resourceId: string, startDate: string, endDate: string, reason: string) => void;
  onDeleteLeave: (id: string) => void;
}) {
  const [wdMode, setWdMode] = useState<WdMode>("mon-sat");
  const { month, roster, bookings, projects, parentProjects, leaves } = state;
  const today = todayStr();

  /* Leave capture lives here rather than on Manage resources: leave is a resource-availability
     fact, so it belongs beside the allocation calendar and utilisation figures it affects. */
  const [leaveResId, setLeaveResId] = useState(roster[0]?.id || "");
  const [leaveStart, setLeaveStart] = useState("");
  const [leaveEnd, setLeaveEnd] = useState("");
  const [leaveReasonText, setLeaveReasonText] = useState("");

  function handleAddLeave() {
    if (!leaveResId || !leaveStart || !leaveEnd) {
      alert("Pick a resource and a start/end date.");
      return;
    }
    if (leaveEnd < leaveStart) {
      alert("End date must be on or after the start date.");
      return;
    }
    onAddLeave(leaveResId, leaveStart, leaveEnd, leaveReasonText.trim());
    setLeaveStart("");
    setLeaveEnd("");
    setLeaveReasonText("");
  }

  /* ---------- Unified allocation calendar ----------
     One row per person across every project at once. The window is driven by actual bookings:
     if Mujamil Zari is booked on one project in October and another in November, the calendar
     runs October → November so both show on a single row. */
  const calDays = useMemo(() => {
    const dates = Object.keys(bookings).map((k) => k.split("|")[0]).sort();
    if (!dates.length) return [];
    return daysInRange(dates[0], dates[dates.length - 1]);
  }, [bookings]);

  /* This view answers "which project is this person on, when" — the sub-scope breakdown is the
     Calendar planner's job, and these dates are only a reflection of what was allocated there.
     So a booking is resolved to its parent project, and every sub-scope of the same project
     shares one colour rather than fragmenting a person's row into a different shade per scope. */
  const projMeta = useMemo(() => {
    const colorOf = new Map(parentProjects.map((pp, i) => [pp.id, PALETTE[i % PALETTE.length]]));
    const nameOf = new Map(parentProjects.map((pp) => [pp.id, pp.name]));
    // Sub-project id -> the parent project it rolls up to.
    return new Map(
      projects.map((p) => [
        p.id,
        {
          parentId: p.parentProjectId ?? "",
          name: (p.parentProjectId && nameOf.get(p.parentProjectId)) || "Unassigned project",
          color: (p.parentProjectId && colorOf.get(p.parentProjectId)) || "#999",
        },
      ]),
    );
  }, [projects, parentProjects]);

  /** Month bands above the day numbers, so a multi-month scroll stays orientated. */
  const monthBands = useMemo(() => {
    const bands: { label: string; span: number }[] = [];
    calDays.forEach((d) => {
      const label = new Date(d.date + "T00:00:00Z").toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
      const last = bands[bands.length - 1];
      if (last && last.label === label) last.span++;
      else bands.push({ label, span: 1 });
    });
    return bands;
  }, [calDays]);

  /** One legend entry per project that has any booking in the window — deduplicated across
   *  sub-scopes, since several sub-scopes of one project are still just that project. */
  const bookedProjects = useMemo(() => {
    const byParent = new Map<string, { name: string; color: string }>();
    Object.values(bookings).forEach((b) => {
      const meta = projMeta.get(b.proj);
      if (!meta) return;
      if (!byParent.has(meta.parentId)) byParent.set(meta.parentId, { name: meta.name, color: meta.color });
    });
    return [...byParent.entries()].map(([id, v]) => ({ id, ...v }));
  }, [bookings, projMeta]);
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
    <>
    <div className="card">
      <h2>Unified allocation calendar</h2>
      <div className="sub">
        Every in-house resource against every project at once, coloured by project
        {calDays.length ? ` — ${calDays[0].date} → ${calDays[calDays.length - 1].date}` : ""}. Hover a cell for the
        project. Scroll sideways; the resource column and date header stay pinned.
      </div>

      {bookedProjects.length > 0 && (
        <div className="legend" style={{ margin: "10px 0" }}>
          <span className="fldlabel" style={{ margin: 0 }}>
            Projects
          </span>
          {bookedProjects.map((p) => (
            <span key={p.id} className="legchip">
              <span className="sw" style={{ background: p.color }} />
              {p.name}
            </span>
          ))}
        </div>
      )}

      {!calDays.length ? (
        <div className="empty">Nothing booked yet — the unified calendar spans whatever is allocated across projects.</div>
      ) : (
        <div className="planner-wrap" style={{ maxHeight: "70vh", overflow: "auto" }}>
          <table className="cal">
            <thead>
              {monthBands.length > 1 && (
                <tr>
                  <th className="namecol" />
                  {monthBands.map((b, i) => (
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
                {calDays.map((d) => (
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
              {roster.map((p) => {
                let booked = 0;
                const cells = calDays.map((d) => {
                  const b = bookings[bkey(d.date, p.id, "P")];
                  const hol = holidayLabel(state, d.date);
                  const lv = leaveReason(state, p.id, d.date);
                  let cls = "cell";
                  if (d.dow === 0 || d.dow === 6) cls += " wknd";
                  if (d.date === today) cls += " today";
                  let style: React.CSSProperties = {};
                  let title: string | undefined;
                  if (b) {
                    booked++;
                    const meta = projMeta.get(b.proj);
                    cls += " mine";
                    style = { "--_pc": meta?.color || "#999" } as React.CSSProperties;
                    if (b.loc === "factory") cls += " fac";
                    title = `${meta?.name ?? "Unassigned project"}${b.loc === "factory" ? " (factory)" : ""}`;
                  } else if (hol) {
                    cls += " blocked";
                    title = "Public holiday: " + hol;
                  } else if (lv !== undefined) {
                    cls += " blocked";
                    title = lv ? "On leave: " + lv : "On leave";
                  }
                  return <td key={d.date} className={cls} style={style} title={title} />;
                });
                return (
                  <tr key={p.id}>
                    <td className="namecol">
                      <div className="nm">{p.name}</div>
                      <div className="tr">{p.trade}</div>
                    </td>
                    {cells}
                    <td className="rowtot">{booked || ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>

    <div className="card">
      <h2>
        Resource utilisation <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>(selected month)</span>
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

    <div className="card">
      <h2>Resource leaves</h2>
      <div className="sub">
        Planned leave ranges block that resource&apos;s cells on the Calendar planner, show as blocked in the unified
        calendar above, and keep the scheduler from assigning them while away.
      </div>
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
            <input
              type="text"
              placeholder="Optional"
              value={leaveReasonText}
              onChange={(e) => setLeaveReasonText(e.target.value)}
            />
          </div>
          <button className="btn primary" onClick={handleAddLeave}>
            Add
          </button>
        </div>
      )}
    </div>
    </>
  );
}
