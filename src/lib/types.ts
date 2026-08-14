/** How a resource is charged. "lumpsum" is for contract resources engaged for a fixed fee for
 *  the whole scope — their cost doesn't scale with booked days or area, so the rate is counted
 *  once per project they're booked on (see projStats in calc.ts). */
export type Unit = "day" | "sqft" | "lumpsum";
export type Band = "P" | "O";
export type Loc = "site" | "factory";

export interface Resource {
  id: string;
  name: string;
  trade: string;
  rate: number;
  unit: Unit;
  /** Scheduling-relevant fields from Manpower's richer format — optional since manual
   *  additions and older uploads won't have them. Granular salary-component columns (PF, room
   *  rent, power, tools, annual leave/ticket/bonus, loan interest) aren't captured here: the
   *  app only ever needs the all-in "Total cost/day" figure already stored as `rate`. */
  empId?: string;
  dept?: string;
  payoutType?: string;
  tradeCode?: string;
  seniority?: string;
  resourceCode?: string;
  /** For contract resources engaged against one specific scheduler activity rather than a whole
   *  Dept: the activity's `sow1|sow2` (lowercased). Two activities can share a Product Name
   *  (Baseline SOW has two "Counter Top" rows), so the name alone can't say which one a vendor
   *  was hired for — this can. Undefined for in-house staff and Dept-wide contracts. */
  scopeKey?: string;
}

export interface MaterialLine {
  id: string;
  item: string;
  cost: number;
}

export interface AreaLine {
  id: string;
  area: string;
  sqft: number;
}

/** A parent project — e.g. "Bimlendu Soulace 101". Groups one or more sub-projects
 *  (the actual scopes of work: Painting, Electrical, ...). */
export interface ParentProject {
  id: string;
  name: string;
  customerHoDate: string | null;
  projectStartDate: string | null;
}

/** One row from an uploaded Project SOW file, kept for traceability into what
 *  generated this sub-project, and consumed by the Gantt scheduler (see scheduler.ts). */
export interface ProjectSowItem {
  id: string;
  area: string;
  productName: string;
  sow1: string;
  sow2: string;
  width: number;
  height: number;
  depth: number;
  sqft: number;
  phase: string;
}

/** A human-entered duration for a scheduler activity whose Baseline SOW row has Scheduler
 *  Methodology = "Manual" (e.g. Snag Correction — decided by the QC manager post-inspection,
 *  not computable from a rate). Keyed by sub-project + SOW1/SOW2, one value per combo. */
export interface ManualDuration {
  id: string;
  subProjectId: string;
  sow1: string;
  sow2: string;
  days: number;
}

/** A sub-project — one scope of work within a parent project. This is the unit
 *  everything else (bookings, P&L, invoices, drawings) attaches to. */
export interface Project {
  id: string;
  name: string;
  color: string;
  revenue: number;
  parentProjectId: string | null;
  targetMarginPct: number | null;
  targetLabourCost: number | null;
  materials: MaterialLine[];
  areas: Record<string, AreaLine[]>;
  sowItems: ProjectSowItem[];
  /** Set when this sub-scope was created for one specific scheduler activity (via the Assign
   *  flow) rather than from a Project SOW upload's Dept grouping. Holds that activity's
   *  `sow1|sow2` (lowercased). Two such sub-scopes may share a display name — identity is the
   *  id, and matching is by this key, never by name. */
  scopeKey?: string;
}

export interface Booking {
  proj: string;
  loc: Loc;
  hrs?: number;
}

export type BookingsMap = Record<string, Booking>;

/** One row of the admin-maintained Baseline SOW reference library — rate-of-work
 *  and scheduling metadata per scope item, keyed by SOW1/SOW2 — consumed by the Gantt
 *  scheduler (see scheduler.ts) to compute hours, sequencing, and dependency chains. */
export interface BaselineSowRow {
  id: string;
  orderOfWork: string;
  productName: string;
  sow1: string;
  sow2: string;
  dependencyScope: string;
  dependentScope1: string;
  schedulerMethodology: string;
  rateOfWork: number;
  uom: string;
  minLabour: number;
  phaseOfWork: string;
  trade1: string;
  trade2: string;
  material: string;
  activityDescription: string;
  /** Department, e.g. "Civil", "Electrical", "Factory" — links this scope item to the
   *  Manpower roster's own Dept field, and is the sub-project grouping key when a Project SOW
   *  is uploaded (see uploadProjectSow in App.tsx). */
  dept: string;
  /** "Area" or "Count" — which basis Rate of Work is computed against; reference only, not
   *  consumed by the scheduler (which already infers this from UoM). */
  areaOrCount: string;
  /** Human-readable formula string documenting how hours are derived, e.g. "*=Rate of work/hr
   *  (Sq ft)/hr/Total modular furniture area" — reference only, not used in computation. */
  calculation: string;
}

/** A resource's planned leave, inclusive date range. Blocks calendar booking cells. */
export interface ResourceLeave {
  id: string;
  resourceId: string;
  startDate: string;
  endDate: string;
  reason: string;
}

/** A company-wide non-working date (distinct from the fixed weekly Sunday rule). */
export interface PublicHoliday {
  id: string;
  date: string;
  label: string;
}

export interface AppState {
  month: string;
  roster: Resource[];
  parentProjects: ParentProject[];
  projects: Project[];
  currentParent: string;
  current: string;
  bookings: BookingsMap;
  baselineSow: BaselineSowRow[];
  leaves: ResourceLeave[];
  holidays: PublicHoliday[];
}

export const bkey = (date: string, resId: string, band: Band) => `${date}|${resId}|${band}`;
