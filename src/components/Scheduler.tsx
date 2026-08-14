"use client";

import { useMemo, useState } from "react";
import type { BaselineSowRow, Loc, Project, PublicHoliday, Resource, ResourceLeave } from "@/lib/types";
import { type GanttResult, type GanttRow, workingDaysInRange } from "@/lib/scheduler";

function dayLabel(dateISO: string) {
  const d = new Date(dateISO + "T00:00:00Z");
  return {
    dow: d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
    num: d.getUTCDate(),
  };
}

const TEXT_COLLAPSE_LENGTH = 40;

function TruncatableCell({ text, expanded, onToggle }: { text: string; expanded: boolean; onToggle: () => void }) {
  if (text.length <= TEXT_COLLAPSE_LENGTH) {
    return <td className="meta-col">{text}</td>;
  }
  return (
    <td className="meta-col" style={{ whiteSpace: "normal", maxWidth: 240, minWidth: 180 }}>
      {expanded ? text : text.slice(0, TEXT_COLLAPSE_LENGTH) + "…"}{" "}
      <button
        className="btn sm"
        style={{ padding: "0 6px", fontSize: 11, lineHeight: "16px" }}
        onClick={onToggle}
        title={expanded ? "Collapse" : "Show full list"}
      >
        {expanded ? "−" : "+"}
      </button>
    </td>
  );
}

export default function Scheduler({
  subProjects,
  baselineSow,
  holidays,
  roster,
  leaves,
  projectStartDate,
  onSetProjectStartDate,
  readOnly,
  onGenerateBookings,
  result,
  onManualDaysChange,
  onAssign,
}: {
  subProjects: Project[];
  baselineSow: BaselineSowRow[];
  holidays: PublicHoliday[];
  roster: Resource[];
  leaves: ResourceLeave[];
  projectStartDate: string | null;
  onSetProjectStartDate: (date: string) => void;
  readOnly: boolean;
  /** Computed in Planner (which also derives the Sub-scope (Trade) chips from it) and passed
   *  down, so the schedule is calculated once per render rather than in two places. */
  result: GanttResult | null;
  onManualDaysChange: (subProjectId: string, sow1: string, sow2: string, days: number) => void;
  /** Opens the contract-resource dialog for one activity row. Offered only where that row has
   *  an unmet trade requirement, so the action always names the exact activity being staffed. */
  onAssign: (row: GanttRow) => void;
  onGenerateBookings: (
    entries: { date: string; resourceId: string; projectId: string; loc: Loc }[],
  ) => Promise<{ inserted: number; skipped: number }>;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  function toggleExpanded(id: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  /* One continuous timeline from the project start date to the last scheduled day — every
     month in a single horizontally-scrolling grid, so the whole plan can be read by scrolling
     rather than paging month by month. (The booking calendar below stays month-at-a-time; it's
     a data-entry grid, not an overview.) */
  const visibleDates = result?.dates ?? [];
  const visibleRows = result?.rows ?? [];

  /** Month bands above the day columns, so a long scroll stays orientated. */
  const monthBands = useMemo(() => {
    const bands: { label: string; span: number }[] = [];
    visibleDates.forEach((d) => {
      const label = new Date(d + "T00:00:00Z").toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
      const last = bands[bands.length - 1];
      if (last && last.label === label) last.span++;
      else bands.push({ label, span: 1 });
    });
    return bands;
  }, [visibleDates]);

  const [generating, setGenerating] = useState(false);
  async function handleGenerate() {
    if (!result) return;
    const entries: { date: string; resourceId: string; projectId: string; loc: Loc }[] = [];
    let virtualRowsSkipped = 0;
    result.rows.forEach((r) => {
      if (!r.assignedResourceIds.length) return;
      if (!r.subProjectId) {
        virtualRowsSkipped++;
        return;
      }
      const loc: Loc = r.dept.trim().toLowerCase() === "factory" ? "factory" : "site";
      const days = workingDaysInRange(r.startDate, r.endDate, holidays);
      days.forEach((d) => {
        r.assignedResourceIds.forEach((resourceId) => entries.push({ date: d, resourceId, projectId: r.subProjectId, loc }));
      });
    });
    if (!entries.length) {
      alert("No assigned resources to book yet — assign people first (see the Trade column) or fix the conflicts shown.");
      return;
    }
    if (
      !confirm(
        `Write ${entries.length} booking cell(s) from the computed schedule into the calendar below?\n\n` +
          `Cells another sub-project already holds are left untouched; anything already booked to the same sub-project is unaffected.` +
          (virtualRowsSkipped ? `\n\n${virtualRowsSkipped} whole-project activity row(s) (e.g. a mandatory phase closer with no single sub-project) were skipped — they need a sub-project of their own before they can be booked.` : ""),
      )
    )
      return;
    setGenerating(true);
    try {
      const { inserted, skipped } = await onGenerateBookings(entries);
      alert(`Done — ${inserted} booking cell(s) written${skipped ? `, ${skipped} skipped (already booked elsewhere)` : ""}.`);
    } catch (err) {
      alert("Could not generate bookings: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="filesection">
      <div className="fshead">
        <span className="lbl">Scheduler — generated from uploaded SOW</span>
      </div>
      <div className="row" style={{ marginBottom: 10 }}>
        <div>
          <span className="fldlabel">Project start date</span>
          <input
            type="date"
            value={projectStartDate || ""}
            disabled={readOnly}
            onChange={(e) => onSetProjectStartDate(e.target.value)}
          />
        </div>
        {result && (
          <button className="btn sm" onClick={() => setShowDetail((v) => !v)}>
            {showDetail ? "Hide" : "Show"} detail columns
          </button>
        )}
        {result && !readOnly && (
          <button className="btn sm primary" onClick={handleGenerate} disabled={generating}>
            {generating ? "Generating…" : "Generate schedule → bookings"}
          </button>
        )}
      </div>
      <p className="muted" style={{ fontSize: 11.5, margin: "0 0 10px" }}>
        Matches each sub-project&apos;s uploaded SOW items against the Baseline SOW library by SOW1/SOW2, consolidates
        items sharing the same scope across areas/products into one activity, recursively adds back dependency-scope
        and MANDATORY-tagged activities so each SOW is actually completed, computes hours from sqft ÷ rate (at 6.5
        productive hours/day), and sequences by Order of Work — same order runs in parallel, the next order starts
        once the previous one finishes. Skips Sundays and public holidays. Recalculates live; nothing here is saved.
        Activities whose Baseline SOW Scheduler Methodology is &quot;Manual&quot; (e.g. Snag Correction) get an
        editable Days field instead of a computed one — set by the QC manager, not a formula. The Trade column
        matches trade1/trade2 directly against the roster&apos;s own Trade text, widened by Dept when the roster has
        no exact-text match, and greedily assigns specific, available people (skipping anyone on leave or already
        busy elsewhere) — a shortfall shows in red with a ⚠ and a tooltip explaining what&apos;s missing. Date
        columns below span the whole project as one horizontally-scrolling timeline. Per-area split-cell colouring
        within a consolidated row isn&apos;t handled yet — this is still a first pass. &quot;Generate schedule →
        bookings&quot; writes the assigned people and computed dates into real bookings on the calendar below —
        further manual edits there save instantly, same as any other booking.
      </p>

      {!projectStartDate && <div className="empty">Set a project start date above to generate the schedule.</div>}
      {projectStartDate && !subProjects.length && <div className="empty">No sub-projects with uploaded SOW items yet.</div>}
      {result && !result.rows.length && (
        <div className="empty">
          None of the {result.unmatchedCount} scope item(s) matched the Baseline SOW library — nothing to schedule.
        </div>
      )}

      {result && visibleRows.length > 0 && (
        <>
          {result.unmatchedCount > 0 && (
            <p className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>
              {result.unmatchedCount} scope item(s) had no matching Baseline SOW entry and were skipped.
            </p>
          )}
          <p className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>
            Full project timeline — {visibleDates[0]} to {visibleDates[visibleDates.length - 1]} across{" "}
            {monthBands.length} month(s). Scroll sideways to move through the schedule.
          </p>
          <div className="gantt-wrap">
            <table className="gantt">
              <thead>
                {/* Month band above the day numbers, so a long horizontal scroll stays legible. */}
                <tr>
                  {/* Product Name, Area, Phase, SOW1/SOW2 (+6 detail columns) then Trade, Hrs, Days. */}
                  <th className="meta-col" colSpan={showDetail ? 13 : 7} />
                  {monthBands.map((b, i) => (
                    <th key={b.label} colSpan={b.span} style={{ borderLeft: i ? "2px solid var(--line-strong)" : undefined }}>
                      {b.label}
                    </th>
                  ))}
                </tr>
                <tr>
                  <th className="meta-col">Product Name</th>
                  <th className="meta-col">Area</th>
                  <th className="meta-col">Phase</th>
                  <th className="meta-col">SOW1 / SOW2</th>
                  {showDetail && (
                    <>
                      <th className="meta-col">Source</th>
                      <th>Qty/SQFT</th>
                      <th>Rate</th>
                      <th>UoM</th>
                      <th>MinLab</th>
                      <th>Order</th>
                    </>
                  )}
                  <th className="meta-col">Trade</th>
                  <th>Hrs</th>
                  <th>Days</th>
                  {visibleDates.map((d) => {
                    const { dow, num } = dayLabel(d);
                    const isSun = new Date(d + "T00:00:00Z").getUTCDay() === 0;
                    const hLabel = holidays.find((h) => h.date === d)?.label;
                    return (
                      <th key={d} className={isSun || hLabel ? "wknd" : ""} title={hLabel || undefined}>
                        {dow}
                        <div>{num}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => (
                  <tr key={r.id}>
                    <TruncatableCell
                      text={r.productName}
                      expanded={expandedRows.has(r.id + ":product")}
                      onToggle={() => toggleExpanded(r.id + ":product")}
                    />
                    <TruncatableCell
                      text={r.area}
                      expanded={expandedRows.has(r.id + ":area")}
                      onToggle={() => toggleExpanded(r.id + ":area")}
                    />
                    <td className="meta-col">{r.phase}</td>
                    <td className="meta-col">
                      {r.sow1} / {r.sow2}
                      {r.gateNote && (
                        <div style={{ color: "var(--warn)", fontSize: 10.5, fontWeight: 600 }} title={r.gateNote}>
                          🔒 on hold
                        </div>
                      )}
                    </td>
                    {showDetail && (
                      <>
                        <td className="meta-col">{r.source}</td>
                        <td>{r.qtyOrSqft.toFixed(1)}</td>
                        <td>{r.rate}</td>
                        <td>{r.uom}</td>
                        <td>{r.minLabour || ""}</td>
                        <td>{r.order}</td>
                      </>
                    )}
                    <td
                      className="meta-col"
                      style={r.hasConflict ? { color: "var(--warn)", fontWeight: 600 } : undefined}
                      title={r.hasConflict ? r.conflictNote : undefined}
                    >
                      {r.assignedResources || r.trade}
                      {r.hasConflict && " ⚠"}
                      {/* The gap belongs to this activity, not to its Dept — two Baseline SOW
                          rows share the Product Name "Counter Top" — so the action to staff it
                          lives here, where the row identifies itself unambiguously. */}
                      {!readOnly && r.unassignedTrades.length > 0 && (
                        <button
                          className="btn sm"
                          style={{ marginLeft: 6, padding: "0 8px", fontSize: 11, lineHeight: "18px" }}
                          onClick={() => onAssign(r)}
                          title={`Contract ${r.unassignedTrades.join(", ")} for ${r.sow1} / ${r.sow2}`}
                        >
                          Assign
                        </button>
                      )}
                    </td>
                    <td>{r.isManual ? "—" : r.hours.toFixed(1)}</td>
                    <td>
                      {r.isManual ? (
                        <input
                          type="number"
                          min={0}
                          step={0.5}
                          disabled={readOnly}
                          defaultValue={r.days || ""}
                          placeholder="Set by QC"
                          style={{ width: 64, textAlign: "right" }}
                          onBlur={(e) => onManualDaysChange(r.subProjectId, r.sow1, r.sow2, Number(e.target.value) || 0)}
                          title="Manually set by the QC manager post-inspection — not computed from a rate."
                        />
                      ) : (
                        r.days.toFixed(2)
                      )}
                    </td>
                    {visibleDates.map((d) => {
                      const isSun = new Date(d + "T00:00:00Z").getUTCDay() === 0;
                      const spanned = d >= r.startDate && d <= r.endDate;
                      return (
                        <td
                          key={d}
                          className={"day" + (isSun ? " wknd" : "") + (spanned ? " gspan" : "")}
                          style={spanned ? { background: r.subProjectColor } : undefined}
                        />
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
