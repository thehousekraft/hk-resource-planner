import type { AppState, Band, Loc, ParentProject, Project, Resource } from "./types";
import { bkey } from "./types";

export const PALETTE = ["#1f6f5c", "#2d5f8a", "#a8562a", "#7a4a86", "#3f7d3f", "#b23b3b", "#8a6d1f", "#4a5568", "#307a7a", "#9a4a6a"];
export const OT_HR_FRAC = 1 / 8;
export const OT_MAX = 5;

export const CUR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
export const NUM = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

export function blankParentProject(name: string): ParentProject {
  return {
    id: "pp" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    name: name || "New project",
    customerHoDate: null,
  };
}

export function blankProject(name: string, idx: number, parentProjectId: string | null): Project {
  return {
    id: "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    name: name || "New sub-project",
    color: PALETTE[idx % PALETTE.length],
    materials: [],
    revenue: 0,
    parentProjectId,
    targetMarginPct: null,
    targetLabourCost: null,
    areas: {},
  };
}

/** Target cost ceiling = quoted price scaled down by the target margin. */
export function targetCostCeiling(proj: Project): number {
  const margin = Number(proj.targetMarginPct) || 0;
  return (Number(proj.revenue) || 0) * (1 - margin / 100);
}
/** What's left for material once the (target or actual) labour figure is subtracted from the ceiling. */
export function materialCeilingRemaining(proj: Project, labourCost: number): number {
  return targetCostCeiling(proj) - labourCost;
}

export function isSqft(p: Resource) {
  return p.unit === "sqft";
}

export function daysOfMonth(mo: string) {
  const [y, m] = mo.split("-").map(Number);
  const n = new Date(y, m, 0).getDate();
  const arr: { d: number; date: string; dow: number; dowLbl: string }[] = [];
  for (let d = 1; d <= n; d++) {
    const dt = new Date(y, m - 1, d);
    arr.push({
      d,
      date: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      dow: dt.getDay(),
      dowLbl: ["S", "M", "T", "W", "T", "F", "S"][dt.getDay()],
    });
  }
  return arr;
}

export function countBand(state: AppState, resId: string, projId: string, band: Band) {
  let n = 0;
  const suf = "|" + resId + "|" + band;
  for (const k in state.bookings) {
    if (k.endsWith(suf) && state.bookings[k].proj === projId) n++;
  }
  return n;
}
export function countBandLoc(state: AppState, resId: string, projId: string, band: Band, loc: Loc) {
  let n = 0;
  const suf = "|" + resId + "|" + band;
  for (const k in state.bookings) {
    const b = state.bookings[k];
    if (k.endsWith(suf) && b.proj === projId && b.loc === loc) n++;
  }
  return n;
}
export function sumOtHours(state: AppState, resId: string, projId: string) {
  let h = 0;
  const suf = "|" + resId + "|O";
  for (const k in state.bookings) {
    const b = state.bookings[k];
    if (k.endsWith(suf) && b.proj === projId) h += b.hrs || 0;
  }
  return h;
}
export function otHoursDay(state: AppState, date: string, resId: string) {
  const b = state.bookings[bkey(date, resId, "O")];
  return b ? b.hrs || 0 : 0;
}
export function hasPrimaryDay(state: AppState, date: string, resId: string) {
  return !!state.bookings[bkey(date, resId, "P")];
}
export function datesForBand(state: AppState, resId: string, projId: string, band: Band) {
  const suf = "|" + resId + "|" + band;
  const dates: string[] = [];
  for (const k in state.bookings) {
    if (k.endsWith(suf) && state.bookings[k].proj === projId) dates.push(k.split("|")[0]);
  }
  return dates.sort();
}
export function holidayLabel(state: AppState, date: string) {
  return state.holidays.find((h) => h.date === date)?.label;
}
export function leaveReason(state: AppState, resId: string, date: string) {
  return state.leaves.find((l) => l.resourceId === resId && date >= l.startDate && date <= l.endDate)?.reason;
}
export function isOnLeave(state: AppState, resId: string, date: string) {
  return state.leaves.some((l) => l.resourceId === resId && date >= l.startDate && date <= l.endDate);
}
export function formatDateList(dates: string[]) {
  return dates
    .map((d) => {
      const dt = new Date(d + "T00:00:00");
      return dt.getDate() + " " + dt.toLocaleDateString("en-US", { month: "short" });
    })
    .join(", ");
}

export interface ProjStats {
  prim: number;
  ot: number;
  sq: number;
  mat: number;
  cost: number;
  rev: number;
  profit: number;
  margin: number;
}
export function projStats(state: AppState, proj: Project): ProjStats {
  let prim = 0,
    ot = 0;
  state.roster.filter((p) => !isSqft(p)).forEach((p) => {
    prim += countBand(state, p.id, proj.id, "P") * p.rate;
    ot += sumOtHours(state, p.id, proj.id) * p.rate * OT_HR_FRAC;
  });
  let sq = 0;
  state.roster.filter((p) => isSqft(p)).forEach((p) => {
    const a = proj.areas?.[p.id] || [];
    a.forEach((x) => (sq += (Number(x.sqft) || 0) * p.rate));
  });
  const mat = (proj.materials || []).reduce((s, m) => s + (Number(m.cost) || 0), 0);
  const rev = Number(proj.revenue) || 0;
  const cost = prim + ot + sq + mat;
  const profit = rev - cost;
  const margin = rev > 0 ? (profit / rev) * 100 : 0;
  return { prim, ot, sq, mat, cost, rev, profit, margin };
}

/** "Today" in India Standard Time, regardless of the server's or browser's own timezone —
 *  this app is used exclusively by an India-based team. */
export function todayStr() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export function monthLabel(mo: string) {
  return mo ? new Date(mo + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "—";
}

export const TRADE_GROUPS: { label: string; match: (t: string) => boolean }[] = [
  { label: "Carpenters", match: (t) => /carpenter/i.test(t) },
  { label: "Electricians", match: (t) => /electric|plumb/i.test(t) },
  { label: "Painters", match: (t) => /paint/i.test(t) },
  { label: "Polishers", match: (t) => /polish/i.test(t) },
  { label: "Assemblers", match: (t) => /assembler/i.test(t) },
  { label: "Gypsum", match: (t) => /gypsum/i.test(t) },
  { label: "Helpers", match: (t) => /helper/i.test(t) },
  { label: "QC", match: (t) => /^qc$/i.test(t) },
  { label: "Management", match: (t) => /management/i.test(t) },
];
export function groupFor(trade: string) {
  const g = TRADE_GROUPS.find((g) => g.match(trade));
  return g ? g.label : "Other";
}

export function debounce<Args extends unknown[]>(fn: (...args: Args) => void, ms: number) {
  let t: ReturnType<typeof setTimeout>;
  return (...args: Args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
