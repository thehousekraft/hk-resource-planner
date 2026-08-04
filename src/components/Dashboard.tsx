"use client";

import type { AppState } from "@/lib/types";
import { CUR, NUM, projStats } from "@/lib/calc";

export default function Dashboard({ state }: { state: AppState }) {
  const { projects } = state;
  let tP = 0,
    tO = 0,
    tS = 0,
    tM = 0,
    tR = 0;
  const rows = projects.map((proj) => {
    const s = projStats(state, proj);
    tP += s.prim;
    tO += s.ot;
    tS += s.sq;
    tM += s.mat;
    tR += s.rev;
    return { proj, s };
  });
  const cost = tP + tO + tS + tM;
  const profit = tR - cost;
  const margin = tR > 0 ? (profit / tR) * 100 : 0;

  return (
    <div className="card">
      <h2>
        Portfolio P&amp;L <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>(all months, all projects)</span>
      </h2>
      <div className="sub">{projects.length} project(s) · costs aggregated across all months</div>
      <div className="sumstrip" style={{ marginBottom: 22 }}>
        <div className="cell2">
          <div className="k">Projects</div>
          <div className="v">{projects.length}</div>
        </div>
        <div className="cell2">
          <div className="k">Revenue</div>
          <div className="v">{CUR.format(tR)}</div>
        </div>
        <div className="cell2">
          <div className="k">Total cost</div>
          <div className="v">{CUR.format(cost)}</div>
        </div>
        <div className="cell2">
          <div className="k">Profit</div>
          <div className={"v " + (profit >= 0 ? "pos" : "neg")}>{CUR.format(profit)}</div>
        </div>
        <div className="cell2">
          <div className="k">Blended margin</div>
          <div className={"v " + (profit >= 0 ? "pos" : "neg")}>{tR > 0 ? NUM.format(margin) + "%" : "—"}</div>
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="dash-table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Primary</th>
              <th>OT</th>
              <th>Sqft</th>
              <th>Material</th>
              <th>Total cost</th>
              <th>Revenue</th>
              <th>Profit</th>
              <th>Margin</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ proj, s }) => (
              <tr key={proj.id}>
                <td>
                  <span
                    style={{
                      display: "inline-block",
                      width: 9,
                      height: 9,
                      borderRadius: 2,
                      background: proj.color,
                      marginRight: 7,
                    }}
                  />
                  {proj.name}
                </td>
                <td>{CUR.format(s.prim)}</td>
                <td>{CUR.format(s.ot)}</td>
                <td>{CUR.format(s.sq)}</td>
                <td>{CUR.format(s.mat)}</td>
                <td>{CUR.format(s.cost)}</td>
                <td>{CUR.format(s.rev)}</td>
                <td>{CUR.format(s.profit)}</td>
                <td>
                  <span className={"pill " + (s.profit >= 0 ? "pos" : "neg")}>{s.rev > 0 ? NUM.format(s.margin) + "%" : "—"}</span>
                </td>
              </tr>
            ))}
            <tr className="total">
              <td>Portfolio total</td>
              <td>{CUR.format(tP)}</td>
              <td>{CUR.format(tO)}</td>
              <td>{CUR.format(tS)}</td>
              <td>{CUR.format(tM)}</td>
              <td>{CUR.format(cost)}</td>
              <td>{CUR.format(tR)}</td>
              <td>{CUR.format(profit)}</td>
              <td>
                <span className={"pill " + (profit >= 0 ? "pos" : "neg")}>{tR > 0 ? NUM.format(margin) + "%" : "—"}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
