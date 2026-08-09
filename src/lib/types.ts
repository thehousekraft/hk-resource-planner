export type Unit = "day" | "sqft";
export type Band = "P" | "O";
export type Loc = "site" | "factory";

export interface Resource {
  id: string;
  name: string;
  trade: string;
  rate: number;
  unit: Unit;
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
}

export interface Booking {
  proj: string;
  loc: Loc;
  hrs?: number;
}

export type BookingsMap = Record<string, Booking>;

/** One row of the admin-maintained Baseline SOW reference library — rate-of-work
 *  and scheduling metadata per scope item, keyed by SOW1/SOW2. Not yet consumed by
 *  any scheduling logic; this is the reference data the future scheduler will read. */
export interface BaselineSowRow {
  id: string;
  orderOfWork: string;
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
