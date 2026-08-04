"use client";

import { Fragment, useRef, useState } from "react";
import type { AppState, Band, Loc } from "@/lib/types";
import { bkey } from "@/lib/types";
import { daysOfMonth, hasPrimaryDay, isSqft } from "@/lib/calc";

const todayStr = new Date().toISOString().slice(0, 10);

export default function Planner({
  state,
  activeLoc,
  setActiveLoc,
  selection,
  readOnly,
  renamingProjectId,
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
}: {
  state: AppState;
  activeLoc: Loc;
  setActiveLoc: (l: Loc) => void;
  selection: Set<string>;
  readOnly: boolean;
  renamingProjectId: string | null;
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
}) {
  const { month, roster, projects, current, bookings } = state;
  const days = daysOfMonth(month);
  const dragging = useRef(false);
  const dragMode = useRef<"add" | "remove">("add");
  const [showMove, setShowMove] = useState(false);
  const [moveTarget, setMoveTarget] = useState("");
  const curProj = projects.find((p) => p.id === current);

  function projColor(id: string) {
    return projects.find((p) => p.id === id)?.color || "#999";
  }

  function primaryMouseDown(date: string, resId: string, shiftKey: boolean) {
    if (readOnly) return;
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
    if (dragMode.current === "add") onSetPrimary(date, resId);
    else onClearPrimary(date, resId);
  }
  function primaryMouseEnter(date: string, resId: string) {
    if (dragging.current) applyPrimary(date, resId);
  }

  function otMouseDown(date: string, resId: string, shiftKey: boolean) {
    if (readOnly) return;
    const key = bkey(date, resId, "O");
    const b = bookings[key];
    if (shiftKey) {
      if (b && b.hrs && b.proj === current) onToggleSelect(key);
      return;
    }
    if (b && b.hrs && b.proj !== current) return;
    onCycleOt(date, resId);
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
        <div className="legend">
          {projects.map((p) =>
            p.id === renamingProjectId ? (
              <span key={p.id} className="legchip active" style={{ padding: "2px 6px 2px 10px" }}>
                <span className="sw" style={{ background: p.color }} />
                <input
                  autoFocus
                  type="text"
                  defaultValue={p.name}
                  style={{ width: 140, padding: "3px 6px", border: "1px solid var(--line-strong)", borderRadius: 6 }}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      onRename(p.id, e.currentTarget.value.trim() || p.name);
                      onRenameDone();
                    } else if (e.key === "Escape") {
                      onRenameDone();
                    }
                  }}
                  onBlur={(e) => {
                    onRename(p.id, e.target.value.trim() || p.name);
                    onRenameDone();
                  }}
                />
              </span>
            ) : (
              <button key={p.id} className={"legchip" + (p.id === current ? " active" : "")} onClick={() => onSetCurrent(p.id)}>
                <span className="sw" style={{ background: p.color }} />
                {p.name}
              </button>
            ),
          )}
        </div>
        {!readOnly && (
          <button className="btn sm" onClick={onAddProject}>
            + New project
          </button>
        )}
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
      <div className="hint">
        Each resource has a <b>Primary</b> row (10am–6pm, 8h) and an <b>OT</b> row (from 6pm, 1-hour blocks). Pick the
        active project (legend) and Site/Factory, then <b>click-drag</b> the primary row to book; click a booked day
        to unbook. On the OT row, <b>click a day to add OT hours</b> (cycles 0→5); OT needs a primary that day (can be
        a different project). Cells owned by other projects are blocked. <b>F</b> marks factory. Shift-click your
        cells to select them, then Move.
      </div>
      <div className="planner-wrap">
        <table className="cal">
          <thead>
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
            {roster.map((p) => {
              let mine = 0;
              let rowh = 0;
              const primaryCells = days.map((d) => {
                const key = bkey(d.date, p.id, "P");
                const b = bookings[key];
                let cls = "cell";
                if (d.dow === 0 || d.dow === 6) cls += " wknd";
                if (d.date === todayStr) cls += " today";
                let style: React.CSSProperties = {};
                if (b) {
                  if (b.proj === current) {
                    cls += " mine";
                    mine++;
                    if (selection.has(key)) cls += " sel";
                  } else cls += " other";
                  if (b.loc === "factory") cls += " fac";
                  style = { "--_pc": projColor(b.proj) } as React.CSSProperties;
                }
                return (
                  <td
                    key={d.date}
                    className={cls}
                    style={style}
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
                let cls = "cell otcell";
                if (d.dow === 0 || d.dow === 6) cls += " wknd";
                if (d.date === todayStr) cls += " today";
                const primHere = hasPrimaryDay(state, d.date, p.id);
                if (!primHere) cls += " noprim";
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
                        <span className={"badge " + (isSqft(p) ? "b-sqft" : "b-day")}>{isSqft(p) ? "sqft" : "day"}</span>
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
