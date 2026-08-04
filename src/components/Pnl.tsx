"use client";

import { useEffect } from "react";
import type { AppState, AreaLine, MaterialLine } from "@/lib/types";
import { CUR, NUM, OT_HR_FRAC, countBand, countBandLoc, isSqft, projStats, sumOtHours } from "@/lib/calc";

export default function Pnl({
  state,
  onSetCurrent,
  onRename,
  onDelete,
  onSetRevenue,
  onAddMaterial,
  onUpdateMaterial,
  onDeleteMaterial,
  onEnsureArea,
  onAddArea,
  onUpdateArea,
  onDeleteArea,
}: {
  state: AppState;
  onSetCurrent: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onSetRevenue: (id: string, revenue: number) => void;
  onAddMaterial: () => void;
  onUpdateMaterial: (id: string, patch: Partial<MaterialLine>) => void;
  onDeleteMaterial: (id: string) => void;
  onEnsureArea: (resId: string) => void;
  onAddArea: (resId: string) => void;
  onUpdateArea: (resId: string, id: string, patch: Partial<AreaLine>) => void;
  onDeleteArea: (resId: string, id: string) => void;
}) {
  const { roster, projects, current, bookings } = state;
  const proj = projects.find((p) => p.id === current);

  const sqftPeople = proj
    ? roster.filter((p) => isSqft(p) && (countBand(state, p.id, proj.id, "P") || sumOtHours(state, p.id, proj.id)))
    : [];

  useEffect(() => {
    if (!proj) return;
    sqftPeople.forEach((p) => {
      if (!proj.areas[p.id]?.length) onEnsureArea(p.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proj?.id, sqftPeople.map((p) => p.id).join(","), bookings]);

  if (!proj) return null;
  const s = projStats(state, proj);

  const dayRows = roster
    .filter((p) => !isSqft(p))
    .map((p) => ({ p, prim: countBand(state, p.id, proj.id, "P"), oth: sumOtHours(state, p.id, proj.id) }))
    .filter((x) => x.prim || x.oth);

  let tP = 0,
    tO = 0;

  return (
    <>
      <div className="card">
        <div className="row">
          <div>
            <span className="fldlabel">Project</span>
            <select value={current} onChange={(e) => onSetCurrent(e.target.value)}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <span className="fldlabel">Rename</span>
            <input type="text" style={{ width: "100%" }} value={proj.name} onChange={(e) => onRename(proj.id, e.target.value)} />
          </div>
          <button className="btn warn sm spacer" style={{ alignSelf: "flex-end" }} onClick={() => onDelete(proj.id)}>
            Delete project
          </button>
        </div>
      </div>

      <div className="card">
        <h2>
          Day-rate labour <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>(all months)</span>
        </h2>
        <div className="sub">Primary = mandays × rate. OT = OT-days × 3/8 × rate. Site/Factory split shown per person.</div>
        {!dayRows.length ? (
          <div className="empty">No day-rate resources booked. Book days on the planner.</div>
        ) : (
          <table className="rtable">
            <thead>
              <tr>
                <th>Name</th>
                <th style={{ textAlign: "right" }}>Rate/day</th>
                <th style={{ textAlign: "right" }}>Primary days</th>
                <th style={{ textAlign: "right" }}>Site/Fac</th>
                <th style={{ textAlign: "right" }}>OT hrs</th>
                <th style={{ textAlign: "right" }}>Primary ₹</th>
                <th style={{ textAlign: "right" }}>OT ₹</th>
                <th style={{ textAlign: "right" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {dayRows.map(({ p, prim, oth }) => {
                const pc = prim * p.rate;
                const oc = oth * p.rate * OT_HR_FRAC;
                tP += pc;
                tO += oc;
                const site = countBandLoc(state, p.id, proj.id, "P", "site");
                const fac = countBandLoc(state, p.id, proj.id, "P", "factory");
                return (
                  <tr key={p.id}>
                    <td>
                      {p.name}
                      <div className="muted" style={{ fontSize: 11 }}>
                        {p.trade}
                      </div>
                    </td>
                    <td style={{ textAlign: "right" }}>{CUR.format(p.rate)}</td>
                    <td style={{ textAlign: "right" }}>{prim}</td>
                    <td style={{ textAlign: "right", fontSize: 12 }}>
                      {site}/{fac}
                    </td>
                    <td style={{ textAlign: "right" }}>{oth || ""}</td>
                    <td style={{ textAlign: "right" }}>{CUR.format(pc)}</td>
                    <td style={{ textAlign: "right" }}>{CUR.format(oc)}</td>
                    <td style={{ textAlign: "right", fontWeight: 560 }}>{CUR.format(pc + oc)}</td>
                  </tr>
                );
              })}
              <tr>
                <td colSpan={5} style={{ textAlign: "right", fontWeight: 700, borderTop: "2px solid var(--ink)" }}>
                  Day labour total
                </td>
                <td style={{ textAlign: "right", fontWeight: 700, borderTop: "2px solid var(--ink)" }}>{CUR.format(tP)}</td>
                <td style={{ textAlign: "right", fontWeight: 700, borderTop: "2px solid var(--ink)" }}>{CUR.format(tO)}</td>
                <td style={{ textAlign: "right", fontWeight: 700, borderTop: "2px solid var(--ink)" }}>{CUR.format(tP + tO)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>
          Sqft labour <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>(area-wise)</span>
        </h2>
        <div className="sub">Contract trades are cost-driven by area sqft. Their calendar days still block their time.</div>
        {!sqftPeople.length ? (
          <div className="empty">No sqft resources booked to this project. Book their days on the planner to enable area entry.</div>
        ) : (
          sqftPeople.map((p) => {
            const list = proj.areas[p.id] || [];
            let sub = 0;
            const days = countBand(state, p.id, proj.id, "P");
            const oth = sumOtHours(state, p.id, proj.id);
            return (
              <div className="area-block" key={p.id}>
                <h3>{p.name}</h3>
                <div className="who">
                  {p.trade} · {CUR.format(p.rate)}/sqft · {days} day(s){oth ? ` + ${oth}h OT` : ""} booked
                </div>
                {list.map((a) => {
                  const c = (Number(a.sqft) || 0) * p.rate;
                  sub += c;
                  return (
                    <div className="area-row" key={a.id}>
                      <input
                        type="text"
                        className="a-name"
                        placeholder="Area (e.g. Kitchen)"
                        value={a.area}
                        onChange={(e) => onUpdateArea(p.id, a.id, { area: e.target.value })}
                      />
                      <input
                        type="number"
                        className="a-sqft"
                        placeholder="sqft"
                        min={0}
                        value={a.sqft || ""}
                        onChange={(e) => onUpdateArea(p.id, a.id, { sqft: Number(e.target.value) || 0 })}
                      />
                      <div className="area-cost">
                        {CUR.format(c)}
                        <div className="ai">{p.rate}/sqft</div>
                      </div>
                      <button className="del-x" onClick={() => onDeleteArea(p.id, a.id)}>
                        ×
                      </button>
                    </div>
                  );
                })}
                <button className="btn sm" onClick={() => onAddArea(p.id)}>
                  + Add area
                </button>
                <span style={{ float: "right", fontWeight: 600 }}>Subtotal {CUR.format(sub)}</span>
              </div>
            );
          })
        )}
      </div>

      <div className="card">
        <h2>Material cost</h2>
        <div className="sub">Material line items for this project.</div>
        <div className="mat-row mat-head">
          <div>Item</div>
          <div>Cost</div>
          <div />
        </div>
        {proj.materials.map((m) => (
          <div className="mat-row" key={m.id}>
            <input
              type="text"
              placeholder="e.g. Plywood, laminate"
              value={m.item}
              onChange={(e) => onUpdateMaterial(m.id, { item: e.target.value })}
            />
            <input
              type="number"
              placeholder="0"
              min={0}
              value={m.cost || ""}
              onChange={(e) => onUpdateMaterial(m.id, { cost: Number(e.target.value) || 0 })}
            />
            <button className="del-x" onClick={() => onDeleteMaterial(m.id)}>
              ×
            </button>
          </div>
        ))}
        <button className="btn sm" onClick={onAddMaterial}>
          + Add material
        </button>
      </div>

      <div className="card">
        <h2>Revenue</h2>
        <div className="sub">Client-billed / quoted value for this project.</div>
        <div className="rev-grid">
          <label>Project revenue</label>
          <input
            type="number"
            min={0}
            step={1000}
            placeholder="0"
            value={proj.revenue || ""}
            onChange={(e) => onSetRevenue(proj.id, Number(e.target.value) || 0)}
          />
        </div>
      </div>

      <div className="card">
        <h2>Activity / Project P&amp;L</h2>
        <div className="sub">{proj.name} · all-months total</div>
        <div className="sumstrip">
          <div className="cell2">
            <div className="k">Primary labour</div>
            <div className="v">{CUR.format(s.prim)}</div>
          </div>
          <div className="cell2">
            <div className="k">OT labour</div>
            <div className="v">{CUR.format(s.ot)}</div>
          </div>
          <div className="cell2">
            <div className="k">Sqft labour</div>
            <div className="v">{CUR.format(s.sq)}</div>
          </div>
          <div className="cell2">
            <div className="k">Material</div>
            <div className="v">{CUR.format(s.mat)}</div>
          </div>
          <div className="cell2">
            <div className="k">Total cost</div>
            <div className="v">{CUR.format(s.cost)}</div>
          </div>
          <div className="cell2">
            <div className="k">Revenue</div>
            <div className="v">{CUR.format(s.rev)}</div>
          </div>
          <div className="cell2">
            <div className="k">Profit</div>
            <div className={"v " + (s.profit >= 0 ? "pos" : "neg")}>{CUR.format(s.profit)}</div>
          </div>
          <div className="cell2">
            <div className="k">Margin</div>
            <div className={"v " + (s.profit >= 0 ? "pos" : "neg")}>{s.rev > 0 ? NUM.format(s.margin) + "%" : "—"}</div>
          </div>
        </div>
      </div>
    </>
  );
}
