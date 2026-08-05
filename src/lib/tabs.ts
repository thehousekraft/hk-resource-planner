export type TabKey = "plan" | "pnl" | "dash" | "bench" | "daily" | "roster" | "users";
export type ConfigurableRole = "editor" | "viewer";

/** Every tab except "users" can be granted to editor/viewer via the RBAC config. */
export const CONFIGURABLE_TABS: { key: Exclude<TabKey, "users">; label: string }[] = [
  { key: "plan", label: "Calendar planner" },
  { key: "pnl", label: "Activity/Scope P&L" },
  { key: "dash", label: "Portfolio dashboard" },
  { key: "bench", label: "Bench & utilisation" },
  { key: "daily", label: "Daily allocation (WhatsApp)" },
  { key: "roster", label: "Manage resources" },
];

export const TAB_LABELS: Record<TabKey, string> = {
  plan: "Calendar planner",
  pnl: "Activity/Scope P&L",
  dash: "Portfolio dashboard",
  bench: "Bench & utilisation",
  daily: "Daily allocation (WhatsApp)",
  roster: "Manage resources",
  users: "Manage users",
};

export const ALL_TAB_KEYS: TabKey[] = ["plan", "pnl", "dash", "bench", "daily", "roster", "users"];

export const DEFAULT_ALLOWED_TABS: Record<ConfigurableRole, TabKey[]> = {
  editor: ["plan", "bench", "daily"],
  viewer: ["plan", "bench", "daily"],
};
