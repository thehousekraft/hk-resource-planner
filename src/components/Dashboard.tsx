"use client";

import { Fragment, useState } from "react";
import type { AppState, Project } from "@/lib/types";
import { CUR, NUM, projStats } from "@/lib/calc";

const UNGROUPED = "__ungrouped__";

export default function Dashboard({ state }: { state: AppState }) {
  const { parentProjects, projects } = state;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  let tP = 0,
    tO = 0,
    tS = 0,
    tM = 0,
    tR = 0;
  const statsByProj = new Map<string, ReturnType<typeof projStats>>();
  projects.forEach((proj) => {
    const s = projStats(state, proj);
    statsByProj.set(proj.id, s);
    tP += s.prim;
    tO += s.ot;
    tS += s.sq;
    tM += s.mat;
    tR += s.rev;
  });
  const cost = tP + tO + tS + tM;
  const profit = tR - cost;
  const margin = tR > 0 ? (profit / tR) * 100 : 0;

  const groups = parentProjects.map((pp) => ({
    id: pp.id,
    name: pp.name,
    subs: projects.filter((p) => p.parentProjectId === pp.id),
  }));
  const orphans = projects.filter((p) => !p.parentProjectId);
  if (orphans.length) groups.push({ id: UNGROUPED, name: "Ungrouped sub-projects", subs: orphans });

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function sumGroup(subs: Project[]) {
    let p = 0,
      o = 0,
      sq = 0,
      m = 0,
      r = 0;
    subs.forEach((proj) => {
      const s = statsByProj.get(proj.id);
      if (!s) return;
      p += s.prim;
      o += s.ot;
      sq += s.sq;
      m += s.mat;
      r += s.rev;
    });
    const c = p + o + sq + m;
    const pr = r - c;
    return { p, o, sq, m, c, r, pr, mg: r > 0 ? (pr / r) * 100 : 0 };
  }

  return (
    <div className="card">
      <h2>
        Portfolio P&amp;L <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>(all months, all projects)</span>
      </h2>
      <div className="sub">
        {parentProjects.length} project(s) · {projects.length} sub-project(s) · costs aggregated across all months
      </div>
      <div className="sumstrip" style={{ marginBottom: 22 }}>
        <div className="cell2">
          <div className="k">Sub-projects</div>
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
            {groups.map((g) => {
              const gs = sumGroup(g.subs);
              const isOpen = !collapsed.has(g.id);
              return (
                <Fragment key={g.id}>
                  <tr className="grouphead" onClick={() => toggle(g.id)}>
                    <td>
                      <span className={"chev" + (isOpen ? " open" : "")}>▶</span> {g.name}
                    </td>
                    <td>{CUR.format(gs.p)}</td>
                    <td>{CUR.format(gs.o)}</td>
                    <td>{CUR.format(gs.sq)}</td>
                    <td>{CUR.format(gs.m)}</td>
                    <td>{CUR.format(gs.c)}</td>
                    <td>{CUR.format(gs.r)}</td>
                    <td>{CUR.format(gs.pr)}</td>
                    <td>
                      <span className={"pill " + (gs.pr >= 0 ? "pos" : "neg")}>{gs.r > 0 ? NUM.format(gs.mg) + "%" : "—"}</span>
                    </td>
                  </tr>
                  {isOpen &&
                    g.subs.map((proj) => {
                      const s = statsByProj.get(proj.id)!;
                      return (
                        <tr key={proj.id} className="subrow">
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
                            <span className={"pill " + (s.profit >= 0 ? "pos" : "neg")}>
                              {s.rev > 0 ? NUM.format(s.margin) + "%" : "—"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                </Fragment>
              );
            })}
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
