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

export interface Project {
  id: string;
  name: string;
  color: string;
  revenue: number;
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
  projects: Project[];
  current: string;
  bookings: BookingsMap;
}

export const bkey = (date: string, resId: string, band: Band) => `${date}|${resId}|${band}`;
