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

export interface AppState {
  month: string;
  roster: Resource[];
  parentProjects: ParentProject[];
  projects: Project[];
  currentParent: string;
  current: string;
  bookings: BookingsMap;
}

export const bkey = (date: string, resId: string, band: Band) => `${date}|${resId}|${band}`;
