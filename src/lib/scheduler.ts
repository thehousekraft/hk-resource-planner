import type { BaselineSowRow, ManualDuration, Project, PublicHoliday, Resource, ResourceLeave } from "./types";

function isWorkingDay(dateISO: string, holidays: PublicHoliday[]): boolean {
  const dow = new Date(dateISO + "T00:00:00Z").getUTCDay();
  if (dow === 0) return false;
  return !holidays.some((h) => h.date === dateISO);
}

function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(dateISO + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function firstWorkingDay(dateISO: string, holidays: PublicHoliday[]): string {
  let d = dateISO;
  while (!isWorkingDay(d, holidays)) d = addDaysISO(d, 1);
  return d;
}

/** The next working day strictly after dateISO. */
function nextWorkingDayAfter(dateISO: string, holidays: PublicHoliday[]): string {
  return firstWorkingDay(addDaysISO(dateISO, 1), holidays);
}

/** Spans `days` (fractional, min 1) working days starting at startISO (inclusive, assumed a
 *  working day already). Returns the last working day the activity occupies (inclusive). */
function spanEndDate(startISO: string, days: number, holidays: PublicHoliday[]): string {
  const wholeDays = Math.max(1, Math.ceil(days));
  let cur = startISO;
  for (let i = 1; i < wholeDays; i++) cur = nextWorkingDayAfter(cur, holidays);
  return cur;
}

export interface GanttRow {
  id: string;
  subProjectId: string;
  subProjectColor: string;
  productName: string;
  area: string;
  phase: string;
  sow1: string;
  sow2: string;
  source: string;
  qtyOrSqft: number;
  rate: number;
  uom: string;
  minLabour: number;
  order: number;
  trade: string;
  /** Baseline SOW's own Dept for this activity (e.g. "Civil", "Electrical", "Factory") —
   *  the link between a sub-project's scope and the roster's Dept field. */
  dept: string;
  hours: number;
  days: number;
  startDate: string;
  endDate: string;
  /** True when Baseline SOW flags this activity's Scheduler Methodology as "Manual" — its
   *  duration is a human decision (e.g. QC manager sizing snag correction post-inspection),
   *  not something a rate can compute. `days` reflects whatever's been entered so far (0 if
   *  nothing yet), rather than a formula result. */
  isManual: boolean;
  /** Specific people assigned by trade, e.g. "Sn Assembler: Sanjay kumar | Jn Assembler:
   *  unassigned". Empty when the activity has no trade requirement. */
  assignedResources: string;
  /** Roster ids behind `assignedResources`, flat (no trade grouping) — consumed by the
   *  "Generate schedule" action to write real bookings for this activity's date range. */
  assignedResourceIds: string[];
  /** True when fewer roster people were free (not on leave, not already busy on another
   *  activity in this same window) than the activity's trade requirement calls for. */
  hasConflict: boolean;
  conflictNote: string;
  /** Trades this activity still has an unmet requirement for — either nobody carries the trade
   *  at all, or everyone who does is already committed elsewhere in this window. Either way it
   *  is a real staffing gap that can be contracted out, so the Planner surfaces each one as a
   *  Sub-scope (Trade) chip to hang a contract resource off. */
  unassignedTrades: string[];
  /** `sow1|sow2` (lowercased) — the stable identity of this activity, independent of Product
   *  Name (which repeats) or sub-project. Used to bind a contract resource and its sub-project to
   *  exactly this row. */
  activityKey: string;
  /** Set when a business precondition (not a staffing one) is still open, e.g. Project Handover
   *  while snag rectification has days outstanding. The dates are still projected so the plan
   *  reads end-to-end, but the note says the milestone can't actually be called yet. */
  gateNote: string;
}

export interface GanttResult {
  rows: GanttRow[];
  unmatchedCount: number;
  dates: string[];
}

/** Net productive hours in a working day (an 8h day minus a ~1.5h break). Applied uniformly
 *  across every trade — confirmed with the user rather than assumed. */
const WORK_HOURS_PER_DAY = 6.5;

function dateRangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** Every working day (Mon–Sat, minus public holidays) from startISO to endISO inclusive —
 *  used by the "Generate schedule" action to expand a row's date range into booking cells. */
export function workingDaysInRange(startISO: string, endISO: string, holidays: PublicHoliday[]): string[] {
  const out: string[] = [];
  let d = startISO;
  while (d <= endISO) {
    if (isWorkingDay(d, holidays)) out.push(d);
    d = addDaysISO(d, 1);
  }
  return out;
}

/** How many people of which trade an activity needs. Baseline SOW's trade1/trade2 are usually
 *  either the same trade twice (e.g. two Cleaners — minLabour is the real headcount) or a
 *  senior+junior pair (one of each, regardless of minLabour, since the data models these as
 *  1:1 pairs rather than a distributable pool). */
function tradeRequirements(base: BaselineSowRow): { trade: string; count: number }[] {
  const t1 = base.trade1.trim();
  const t2 = base.trade2.trim();
  if (!t1 && !t2) return [];
  if (!t2 || t1.toLowerCase() === t2.toLowerCase()) {
    return [{ trade: t1 || t2, count: Math.max(1, Math.round(base.minLabour) || 1) }];
  }
  return [
    { trade: t1, count: 1 },
    { trade: t2, count: 1 },
  ];
}

/** Greedily assigns specific roster people to an activity's date range. Candidates are the
 *  union of an exact trade-text match (Baseline SOW's trade1/trade2 against the roster's own
 *  Trade field) and a same-Dept match (Baseline SOW's Dept against the roster's own Dept) —
 *  Dept is the primary link the two files now share, but naming still drifts in places (e.g.
 *  Baseline SOW's "Painting" Dept vs. Manpower's "Paint/Polish" Dept), so exact trade-text
 *  candidates are tried first and Dept only widens the pool rather than replacing trade
 *  matching outright. A candidate is skipped if they're on planned leave any day in the range,
 *  or already assigned to another activity whose range overlaps this one — `busyRanges`
 *  accumulates across the whole schedule so nobody gets double-booked across parallel or
 *  sequential activities alike. Shortfalls are reported, never silently dropped.
 *
 *  Contract resources are scoped, unlike in-house staff. Baseline SOW uses "Vendor" as a
 *  generic placeholder across 20+ unrelated rows (Counter Top, Kitchen Appliance, Glass/Mirror,
 *  Upholstery, ...), so a vendor engaged for one scope would otherwise be matched into every
 *  other scope that also says "Vendor" — an appliance fitter turning up as the countertop crew.
 *  A contract resource therefore only serves the scope it was hired for, identified by the Dept
 *  stamped on it when it was added. In-house staff stay globally matchable: a carpenter really
 *  can work any scope needing a carpenter. */
function assignResources(
  dept: string,
  productName: string,
  activityKey: string,
  requirements: { trade: string; count: number }[],
  start: string,
  end: string,
  roster: Resource[],
  leaves: ResourceLeave[],
  busyRanges: Map<string, { start: string; end: string }[]>,
): {
  assignedResources: string;
  assignedResourceIds: string[];
  hasConflict: boolean;
  conflictNote: string;
  unassignedTrades: string[];
} {
  const parts: string[] = [];
  const ids: string[] = [];
  const conflicts: string[] = [];
  const unassignedTrades: string[] = [];
  const deptLower = dept.trim().toLowerCase();
  const productLower = productName.trim().toLowerCase();
  /** A contract resource is engaged for one scope only. `scopeKey` pins it to a single
   *  activity (sow1|sow2) and wins when present — two Baseline SOW rows share the Product Name
   *  "Counter Top", so name alone can't tell them apart. Older contracts without a scopeKey
   *  fall back to Dept/Product Name matching. */
  const servesThisScope = (r: Resource) => {
    const isContract = r.payoutType?.trim().toLowerCase() === "contract";
    if (!isContract) return true;
    if (r.scopeKey) return r.scopeKey === activityKey;
    const hiredFor = r.dept?.trim().toLowerCase();
    if (!hiredFor) return true;
    return hiredFor === deptLower || hiredFor === productLower;
  };
  requirements.forEach(({ trade, count }) => {
    if (!trade) return;
    const tradeLower = trade.toLowerCase();
    const candidates = roster
      .filter((r) => r.trade.trim().toLowerCase() === tradeLower || (deptLower && r.dept?.trim().toLowerCase() === deptLower))
      .filter(servesThisScope)
      .sort((a, b) => Number(a.trade.trim().toLowerCase() !== tradeLower) - Number(b.trade.trim().toLowerCase() !== tradeLower));
    const available = candidates.filter((r) => {
      const onLeave = leaves.some((l) => l.resourceId === r.id && dateRangesOverlap(start, end, l.startDate, l.endDate));
      if (onLeave) return false;
      const busy = busyRanges.get(r.id) || [];
      return !busy.some((b) => dateRangesOverlap(start, end, b.start, b.end));
    });
    const picked = available.slice(0, count);
    picked.forEach((p) => {
      const busy = busyRanges.get(p.id) || [];
      busy.push({ start, end });
      busyRanges.set(p.id, busy);
      ids.push(p.id);
    });
    // Name-first ("Madhu (Transport)") rather than trade-first: once someone is actually
    // assigned, who is doing the work is the useful information — the trade is context.
    if (picked.length) parts.push(picked.map((p) => `${p.name} (${trade})`).join(", "));
    // A contractor is engaged to complete the scope, not to supply a headcount — how many people
    // they put on it is their business. Baseline SOW's "Count of minimum labour" sizes an
    // in-house crew, so it stops applying once the activity is contracted out. Without this, a
    // vendor on an activity with min labour 2 would sit permanently at ⚠ asking for a second
    // body that is never going to be hired.
    const coveredByContract = picked.some((p) => p.payoutType?.trim().toLowerCase() === "contract");
    if (picked.length < count && !coveredByContract) {
      const shortfall = count - picked.length;
      conflicts.push(
        candidates.length === 0
          ? `no "${trade}" on the roster (checked trade text and Dept "${dept}")`
          : `${shortfall} more "${trade}" needed (${candidates.length} on roster/dept, ${available.length} free ${start}–${end})`,
      );
      if (!picked.length) parts.push(`${trade}: unassigned`);
      // Any unmet requirement is a real staffing gap that can be contracted out — whether
      // nobody carries the trade at all, or the people who do are already committed elsewhere
      // in this window. Two Counter Top activities running the same day each needing a Vendor
      // genuinely need two crews; reporting only the "no candidates" case would leave the
      // second one with a ⚠ and no way to resolve it.
      unassignedTrades.push(trade);
    }
  });
  return {
    assignedResources: parts.join(" | "),
    assignedResourceIds: ids,
    hasConflict: conflicts.length > 0,
    conflictNote: conflicts.join("; "),
    unassignedTrades,
  };
}

/** Resolves one dependent-scope target string against the Baseline library. Some SOW1
 *  category names literally include "(Mandatory)" as part of their name (e.g. "Site QC
 *  (Mandatory)", "Finish (Grouting Mandatory)"), so a literal match is tried first — against
 *  SOW1, then SOW2 (preferring the triggering activity's own SOW1, else any). Only if nothing
 *  matches literally do we fall back to stripping a "(... Mandatory)" suffix and matching the
 *  remainder against SOW1, per Instructions v2 rule 16. */
function resolveDependentTarget(raw: string, triggerSow1: string, baselineSow: BaselineSowRow[]): BaselineSowRow | undefined {
  const rawLower = raw.trim().toLowerCase();
  if (!rawLower) return undefined;
  const literalSow1 = baselineSow.find((b) => b.sow1.trim().toLowerCase() === rawLower);
  if (literalSow1) return literalSow1;
  const sameSow1 = baselineSow.find((b) => b.sow2.trim().toLowerCase() === rawLower && b.sow1.trim().toLowerCase() === triggerSow1);
  if (sameSow1) return sameSow1;
  const anySow1 = baselineSow.find((b) => b.sow2.trim().toLowerCase() === rawLower);
  if (anySow1) return anySow1;
  const mandatoryMatch = /^(.*?)\s*\([^)]*mandatory[^)]*\)\s*$/i.exec(raw);
  if (mandatoryMatch && mandatoryMatch[1].trim()) {
    return baselineSow.find((b) => b.sow1.trim().toLowerCase() === mandatoryMatch[1].trim().toLowerCase());
  }
  return undefined;
}

/** Factory production (Dept "Factory" — e.g. Modular Manufacturing) exists solely to build the
 *  project's modular furniture, so its quantity is whatever modular scope actually triggered
 *  it. It must never be auto-created as a whole-project "(Mandatory)" closer: with no modular
 *  furniture in the Project SOW there is nothing to manufacture at all, and firing it anyway
 *  would size it against the entire project's sqft (the 2842 vs. 496 discrepancy). It only ever
 *  legitimately arrives through a real dependency chain from the modular rows. Detected via the
 *  V2 Baseline SOW's own Dept marker, with a name fallback for rows uploaded before Dept
 *  existed or left blank. */
function isFactoryProduction(b: BaselineSowRow): boolean {
  if (b.dept.trim().toLowerCase() === "factory") return true;
  return /manufactur/i.test(b.sow1) || /manufactur/i.test(b.sow2);
}

/** Baseline SOW's "Dependent Scope 1" is free text — usually one target, but occasionally two
 *  joined by " / " (spaces around the slash mark it as a list separator; a tight slash like
 *  "Sink/Wash basin" is part of a single compound name and must not be split). Returns every
 *  dependent base that resolved (Instructions v2 rules 14 & 16); unresolvable pieces (a
 *  category not yet in the library) are silently skipped. */
function findDependentBases(triggerBase: BaselineSowRow, baselineSow: BaselineSowRow[]): BaselineSowRow[] {
  const raw = triggerBase.dependentScope1.trim();
  if (!raw) return [];
  const triggerSow1 = triggerBase.sow1.trim().toLowerCase();
  return raw
    .split(/\s+\/\s+/)
    .map((piece) => resolveDependentTarget(piece, triggerSow1, baselineSow))
    .filter((b): b is BaselineSowRow => !!b);
}

/** Matches every sub-project's uploaded SOW items against the Baseline SOW library by
 *  SOW1+SOW2, consolidates same-scope items across areas/products into one activity (the
 *  team doing e.g. carcass installation works through the whole sqft sequentially, not once
 *  per room), recursively adds back any dependency-scope activity (including MANDATORY-tagged
 *  ones) so each SOW is actually completed, auto-includes whole-project "(Mandatory)" closer
 *  activities nothing else triggers (e.g. General Cleaning after all of Phase 1), computes
 *  hours/duration, and sequences by Order of Work (same order runs in parallel, the next order
 *  starts once the previous one finishes). Working days are Mon–Sat, minus any public holiday.
 *  Recomputed live each render — nothing here is persisted.
 *
 *  Matches trade1/trade2 directly against the roster's Trade text to greedily assign specific
 *  people (skipping anyone on leave or already busy on an overlapping activity), flagging a
 *  conflict when the roster can't cover the requirement.
 *
 *  Deliberately out of scope for this pass (see roadmap): per-area split-cell colouring within
 *  a consolidated row. */
export function computeGantt(
  subProjects: Project[],
  baselineSow: BaselineSowRow[],
  holidays: PublicHoliday[],
  projectStartDate: string,
  manualDurations: ManualDuration[] = [],
  roster: Resource[] = [],
  leaves: ResourceLeave[] = [],
): GanttResult {
  const busyRanges = new Map<string, { start: string; end: string }[]>();
  const manualDurationIndex = new Map<string, number>();
  manualDurations.forEach((m) => {
    manualDurationIndex.set(m.subProjectId + "|" + m.sow1.trim().toLowerCase() + "|" + m.sow2.trim().toLowerCase(), m.days);
  });

  const baselineIndex = new Map<string, BaselineSowRow>();
  baselineSow.forEach((b) => {
    const key = b.sow1.trim().toLowerCase() + "|" + b.sow2.trim().toLowerCase();
    if (!baselineIndex.has(key)) baselineIndex.set(key, b);
  });

  // Beyond the strict (SOW1,SOW2) compound match, a Project SOW item's own SOW2 is also
  // checked against Baseline's SOW1 (some categories — e.g. painting — store the same text as
  // both, so "Wall Re-Painting (Tu-Pu, 2c-Pr)" is itself a SOW1), then against Baseline's SOW2
  // under any SOW1 (frees the match from a possibly wrong/missing SOW1 on the Project SOW
  // side, e.g. "Plumbing" vs. Baseline's "Plumbing (Mandatory)"). Both fallbacks only fire when
  // they resolve to exactly one *distinct* baseline row — a SOW2 value shared by a multi-child
  // category (e.g. "Civil" has 7 children) or genuinely duplicated across two different SOW1s
  // is left unmatched rather than guessed, since picking the wrong row would compute the wrong
  // rate/trade. A SOW2 duplicated verbatim under the very same SOW1 (a data-entry repeat, not
  // an ambiguity) still counts as unique — matched by distinct SOW1 text, not raw row count.
  const bySow1Only = new Map<string, BaselineSowRow[]>();
  const bySow2Only = new Map<string, BaselineSowRow[]>();
  baselineSow.forEach((b) => {
    const s1 = b.sow1.trim().toLowerCase();
    const s2 = b.sow2.trim().toLowerCase();
    if (s1) {
      if (!bySow1Only.has(s1)) bySow1Only.set(s1, []);
      bySow1Only.get(s1)!.push(b);
    }
    if (s2) {
      if (!bySow2Only.has(s2)) bySow2Only.set(s2, []);
      bySow2Only.get(s2)!.push(b);
    }
  });
  function matchBaseline(item: { sow1: string; sow2: string }): BaselineSowRow | undefined {
    const s1 = item.sow1.trim().toLowerCase();
    const s2 = item.sow2.trim().toLowerCase();
    const exact = baselineIndex.get(s1 + "|" + s2);
    if (exact) return exact;
    if (!s2) return undefined;
    // bySow1Only is already grouped by SOW1 text, so a single-row result here means that SOW1
    // has exactly one SOW2 child (unambiguous which rate/trade applies) — e.g. the painting
    // categories, where SOW1 and SOW2 are the same text and there's only ever one row.
    const asSow1 = bySow1Only.get(s2);
    if (asSow1 && asSow1.length === 1) return asSow1[0];
    // bySow2Only can genuinely repeat the same (SOW1,SOW2) pair verbatim (a data-entry
    // duplicate, not an ambiguity) — so uniqueness here is judged by distinct SOW1 text, not
    // raw row count.
    const asSow2 = bySow2Only.get(s2);
    if (asSow2) {
      const distinctSow1 = new Set(asSow2.map((b) => b.sow1.trim().toLowerCase()));
      if (distinctSow1.size === 1) return asSow2[0];
    }
    return undefined;
  }

  type Item = Project["sowItems"][number];
  type Activity = { items: Item[]; sub: Project; base: BaselineSowRow; source: string };
  const activityByKey = new Map<string, Activity>();
  let unmatchedCount = 0;
  subProjects.forEach((sub) => {
    sub.sowItems.forEach((item) => {
      const base = matchBaseline(item);
      if (!base) {
        unmatchedCount++;
        return;
      }
      // consolidate every item sharing this sub-project + the *resolved* SOW1/SOW2 into one
      // activity — it's the same team working through the combined scope, not one pass per
      // room. Keyed by the base row's own identity (not the item's raw text) since a fallback
      // match can resolve several differently-worded items to the same baseline row.
      const baseKey = base.sow1.trim().toLowerCase() + "|" + base.sow2.trim().toLowerCase();
      const groupKey = sub.id + "|" + baseKey;
      const existing = activityByKey.get(groupKey);
      if (existing) existing.items.push(item);
      else activityByKey.set(groupKey, { items: [item], sub, base, source: "Project SOW" });
    });
  });

  // Recursively add back dependency-scope activities (Instructions v2 rules 14–16). Each
  // dependent inherits the same items (same area/sqft) as whatever triggered it, since it's
  // completing the same physical scope, just under its own baseline rate/order/trade.
  const virtualSub = { id: "", color: "#6b6f76" } as Project;
  /** The Dept-grouped sub-scope an activity belongs to. Activity-scoped sub-scopes (scopeKey
   *  set) are contract engagements carrying no SOW items, so they're never the answer here. */
  const scopeForDept = (dept: string): Project | undefined => {
    const d = dept.trim().toLowerCase();
    if (!d) return undefined;
    return subProjects.find((sp) => !sp.scopeKey && sp.name.trim().toLowerCase() === d);
  };

  function resolveDependencyQueue(queue: Activity[]) {
    let guardIterations = 0;
    while (queue.length && guardIterations < 1000) {
      guardIterations++;
      const cur = queue.shift()!;
      if (cur.base.dependencyScope.trim().toLowerCase() !== "y") continue;
      findDependentBases(cur.base, baselineSow).forEach((depBase) => {
        const depKey = cur.sub.id + "|" + depBase.sow1.trim().toLowerCase() + "|" + depBase.sow2.trim().toLowerCase();
        const existingDep = activityByKey.get(depKey);
        if (existingDep) {
          // A directly-matched activity (its own real Project SOW rows) must never be polluted
          // by another activity's dependency chain landing on the same SOW1/SOW2 — e.g. Hardware
          // Fixture lists MOD_SHUTTER as its own dependent, but MOD_SHUTTER already has its own
          // 211.53 sqft from Project SOW and must not absorb MOD_CARCASS's hardware items too.
          // Only merge when the shared target is itself dependency-sourced (e.g. two different
          // activities both feeding into factory Manufacturing, which has no direct SOW rows).
          if (existingDep.source === "Project SOW") return;
          const existingIds = new Set(existingDep.items.map((it) => it.id));
          cur.items.forEach((it) => {
            if (!existingIds.has(it.id)) existingDep.items.push(it);
          });
          return;
        }
        // Normally a dependency inherits its trigger's sub-scope. But when the trigger is itself
        // a synthetic whole-project row (no real sub-scope — Site QC, whose Dept "QC" has no
        // sub-scope), the dependent would inherit an empty id: it couldn't be booked, costed, or
        // carry a manual duration, since those all key off a real sub-project. Fall back to the
        // dependent's own Dept in that case — Snag Correction (Dept "Modular Furniture") lands
        // there rather than nowhere.
        const depSub = cur.sub.id ? cur.sub : scopeForDept(depBase.dept) ?? cur.sub;
        const depActivity: Activity = { items: [...cur.items], sub: depSub, base: depBase, source: "Dependency add-back" };
        activityByKey.set(depKey, depActivity);
        queue.push(depActivity);
      });
    }
  }
  resolveDependencyQueue([...activityByKey.values()]);

  // Whole-project "(Mandatory)"-tagged activities that nothing directly matched or chained
  // into still always run once — but only genuine orphans like "Cleaning (Mandatory)/General
  // cleaning" that no other baseline row names as its own dependent. A mandatory category that
  // IS someone's explicit dependent (e.g. Manufacturing → Material Dispatch) must only ever be
  // reached through that real chain, sized by whatever actually triggered it — not treated as
  // an independent whole-project closer, or it would fire even when its real trigger never did,
  // sized by the wrong (whole-project) quantity instead of what it's actually dispatching.
  const referencedAsDependent = new Set<string>();
  baselineSow.forEach((r) => {
    if (r.dependencyScope.trim().toLowerCase() !== "y") return;
    findDependentBases(r, baselineSow).forEach((dep) => {
      referencedAsDependent.add(dep.sow1.trim().toLowerCase() + "|" + dep.sow2.trim().toLowerCase());
    });
  });

  // No special phase-gating logic is needed for "runs after all of Phase 1" — sequencing
  // already waits for every lower-order activity project-wide to finish, and this project's
  // Order of Work numbers already line up with its phase boundaries (Phase 1 = orders 0–5,
  // Phase 2 starts at 6).
  //
  // Quantity comes from the sub-scope matching the activity's own Dept, not from the whole
  // project. Summing every SOW line would add unrelated measurement bases together — wall
  // paint area + furniture surface area + gypsum ceiling area, plus rows where sqft is really
  // a count (2 appliances, 1 plumbing point) — producing a figure with no physical meaning.
  // For General Cleaning (Dept "Cleaning") that inflated the basis to 2842 sqft against the
  // 669 sqft its own scope actually covers. Falls back to the project total only when the Dept
  // matches no sub-scope, so a genuinely project-wide closer still gets a sensible basis.
  const totalProjectSqft = subProjects.reduce((s, sp) => s + sp.sowItems.reduce((s2, it) => s2 + it.sqft, 0), 0);
  const sqftOf = (sp: Project) => sp.sowItems.reduce((s, it) => s + it.sqft, 0);
  for (let pass = 0; pass < 5; pass++) {
    const present = new Set([...activityByKey.values()].map((a) => a.base.sow1.trim().toLowerCase()));
    const missing = new Map<string, BaselineSowRow>();
    baselineSow.forEach((b) => {
      const key = b.sow1.trim().toLowerCase();
      const refKey = key + "|" + b.sow2.trim().toLowerCase();
      if (
        /\(mandatory\)/i.test(b.sow1) &&
        !present.has(key) &&
        !missing.has(key) &&
        !referencedAsDependent.has(refKey) &&
        !isFactoryProduction(b)
      ) {
        missing.set(key, b);
      }
    });
    if (!missing.size) break;
    const newQueue: Activity[] = [];
    missing.forEach((mbase) => {
      const key = "__whole_project__|" + mbase.sow1.trim().toLowerCase() + "|" + mbase.sow2.trim().toLowerCase();
      const deptScope = scopeForDept(mbase.dept);
      const syntheticItem: Item = {
        id: "phase-" + mbase.sow1.replace(/\s+/g, "").toLowerCase(),
        area: deptScope ? deptScope.name : "Whole project",
        productName: mbase.productName || mbase.sow1,
        sow1: mbase.sow1,
        sow2: mbase.sow2,
        width: 0,
        height: 0,
        depth: 0,
        sqft: deptScope ? sqftOf(deptScope) : totalProjectSqft,
        phase: mbase.phaseOfWork,
      };
      // Belonging to its Dept's sub-scope also makes the row bookable and costs it there,
      // rather than stranding it on the synthetic whole-project placeholder.
      const activity: Activity = {
        items: [syntheticItem],
        sub: deptScope ?? virtualSub,
        base: mbase,
        source: "Mandatory phase closer",
      };
      activityByKey.set(key, activity);
      newQueue.push(activity);
    });
    resolveDependencyQueue(newQueue);
  }

  const activities = [...activityByKey.values()];

  const orderOf = (a: Activity) => {
    const n = Number(a.base.orderOfWork);
    return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
  };
  const orders = [...new Set(activities.map(orderOf))].sort((a, b) => a - b);

  const rows: GanttRow[] = [];
  let groupStart = firstWorkingDay(projectStartDate, holidays);

  /* Off-site production (Dept "Factory") happens at the factory while the site crew works, so
     it must never push site activities out — the site sequence continues from Floor Protection
     regardless of how long manufacturing takes. What it *does* gate is whatever it feeds:
     Material Dispatch can't leave the factory before the goods are built, and separately can't
     land on site until Phase 1 finishes (its own Order of Work already puts it after General
     Cleaning). Keyed by the dependent activity's sow1|sow2. */
  const factoryEndByDependent = new Map<string, string>();

  orders.forEach((ord) => {
    // Factory rows first within an order group: they're the off-site strand, so they read
    // above the site work that starts the same day (Manufacturing above Floor Mat).
    const groupActivities = activities
      .filter((a) => orderOf(a) === ord)
      .sort((x, y) => Number(!isFactoryProduction(x.base)) - Number(!isFactoryProduction(y.base)));
    let groupMaxEnd = groupStart;
    groupActivities.forEach((a) => {
      const isManual = a.base.schedulerMethodology.trim().toLowerCase().includes("manual");
      // Baseline SOW's own "Calculation" column documents exactly two formulas, keyed off
      // Scheduler Methodology rather than UoM text: every "Rate of work/hr" row divides a
      // continuous quantity (sqft, or "Rn ft" running length — Metal Strip (Patti) is UoM "Rn
      // ft" but still divides, per its own Calculation cell) by the rate; every "Activity/Item"
      // row multiplies a discrete item count by an hrs-per-item rate. Keying off UoM text
      // instead (e.g. checking for "sq") misreads non-sqft continuous units like "Rn ft" and
      // silently applies the wrong formula — using Methodology matches the standard for every
      // row in the library, sqft or not.
      const isRateBased = a.base.schedulerMethodology.trim().toLowerCase() === "rate of work/hr";
      const rate = a.base.rateOfWork || 0;
      const qtyOrSqft = isRateBased ? a.items.reduce((s, it) => s + it.sqft, 0) : a.items.length;
      let days: number;
      let hours: number;
      if (isManual) {
        const manualKey = a.sub.id + "|" + a.base.sow1.trim().toLowerCase() + "|" + a.base.sow2.trim().toLowerCase();
        days = manualDurationIndex.get(manualKey) ?? 0;
        hours = days * WORK_HOURS_PER_DAY;
      } else {
        hours = rate > 0 ? (isRateBased ? qtyOrSqft / rate : qtyOrSqft * rate) : 0;
        days = hours / WORK_HOURS_PER_DAY;
      }
      const activityKeyForStart = a.base.sow1.trim().toLowerCase() + "|" + a.base.sow2.trim().toLowerCase();
      // Wait on the factory when this activity is what the factory feeds; otherwise the order
      // group's own start applies.
      const gatedBy = factoryEndByDependent.get(activityKeyForStart);
      const start = gatedBy && gatedBy >= groupStart ? nextWorkingDayAfter(gatedBy, holidays) : groupStart;
      const end = spanEndDate(start, days, holidays);
      const offSite = isFactoryProduction(a.base);
      // Off-site work runs alongside the site sequence and must not extend it.
      if (!offSite && end > groupMaxEnd) groupMaxEnd = end;
      if (offSite) {
        findDependentBases(a.base, baselineSow).forEach((dep) => {
          const depKey = dep.sow1.trim().toLowerCase() + "|" + dep.sow2.trim().toLowerCase();
          const prior = factoryEndByDependent.get(depKey);
          if (!prior || end > prior) factoryEndByDependent.set(depKey, end);
        });
      }
      const distinct = (vals: string[]) => [...new Set(vals.filter(Boolean))];
      const productName = a.base.productName || distinct(a.items.map((it) => it.productName)).join(", ");
      const activityKey = a.base.sow1.trim().toLowerCase() + "|" + a.base.sow2.trim().toLowerCase();
      const { assignedResources, assignedResourceIds, hasConflict, conflictNote, unassignedTrades } = assignResources(
        a.base.dept,
        productName,
        activityKey,
        tradeRequirements(a.base),
        start,
        end,
        roster,
        leaves,
        busyRanges,
      );
      rows.push({
        id: a.sub.id + "|" + a.base.sow1 + "|" + a.base.sow2,
        subProjectId: a.sub.id,
        subProjectColor: a.sub.color,
        productName,
        area: distinct(a.items.map((it) => it.area)).join(" + "),
        phase: a.base.phaseOfWork,
        sow1: a.base.sow1,
        sow2: a.base.sow2,
        source: a.source,
        qtyOrSqft,
        rate,
        uom: a.base.uom,
        minLabour: a.base.minLabour,
        order: ord === Number.MAX_SAFE_INTEGER ? 0 : ord,
        trade: [a.base.trade1, a.base.trade2].filter((t, i, arr) => t && arr.indexOf(t) === i).join(" + "),
        dept: a.base.dept,
        hours,
        days,
        startDate: start,
        endDate: end,
        isManual,
        assignedResources,
        assignedResourceIds,
        hasConflict,
        conflictNote,
        unassignedTrades,
        activityKey,
        gateNote: "",
      });
    });
    groupStart = nextWorkingDayAfter(groupMaxEnd, holidays);
  });

  /* Project Handover closes the job, and can only be called once snag rectification is closed
     out — which the QC manager signals by setting its manual Days to 0. While any snag row
     still carries days, the handover is projected (so the plan reads end-to-end) but flagged as
     not yet achievable, rather than silently presenting a date the site can't actually hit. */
  const openSnagDays = rows
    .filter((r) => /snag/i.test(r.sow1) || /snag/i.test(r.sow2))
    .reduce((s, r) => s + (r.days > 0 ? r.days : 0), 0);
  if (openSnagDays > 0) {
    rows.forEach((r) => {
      if (/handover/i.test(r.sow1) || /handover/i.test(r.sow2)) {
        r.gateNote = `Blocked — snag rectification still open (${openSnagDays.toFixed(2)} day(s)). Handover clears once its Days is set to 0.`;
      }
    });
  }

  // Within an order, off-site production lists above the site work it runs alongside.
  const offSiteRow = (r: GanttRow) => Number(r.dept.trim().toLowerCase() !== "factory" && !/manufactur/i.test(r.sow1));
  rows.sort(
    (a, b) => a.order - b.order || offSiteRow(a) - offSiteRow(b) || a.startDate.localeCompare(b.startDate),
  );

  const dates: string[] = [];
  if (rows.length) {
    let minStart = rows[0].startDate;
    let maxEnd = rows[0].endDate;
    rows.forEach((r) => {
      if (r.startDate < minStart) minStart = r.startDate;
      if (r.endDate > maxEnd) maxEnd = r.endDate;
    });
    let d = minStart;
    while (d <= maxEnd) {
      dates.push(d);
      d = addDaysISO(d, 1);
    }
  }

  return { rows, unmatchedCount, dates };
}
