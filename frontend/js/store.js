// Shared app state: metadata (categories, intervals) and category styling.

import { api } from "./api.js";

export const state = { meta: null, profile: null, dueCount: 0, user: null };

// Fixed category -> color-slot mapping (color follows the entity, never its rank).
// Thirteen categories share eight validated slots; related categories share a hue family.
// Loans take the blue of banks; red goes to streaming (and stays away from loans and money).
const CATEGORY_SLOT = {
  loan: 1,
  other: 1,
  electricity: 2,
  car_insurance: 3,
  liability: 3,
  household: 3,
  legal_protection: 3,
  insurance: 3,
  gas: 4,
  mobile: 5,
  fitness: 6,
  internet: 7,
  streaming: 8,
};
// In slot order: neighbouring slots were validated for colour-blind separation.
export const GROUPS = [
  { key: "other", label: "Kredite & Sonstiges", slot: 1 },
  { key: "electricity", label: "Strom", slot: 2 },
  { key: "insurance", label: "Versicherungen", slot: 3 },
  { key: "gas", label: "Gas", slot: 4 },
  { key: "mobile", label: "Mobilfunk", slot: 5 },
  { key: "fitness", label: "Fitness & Vereine", slot: 6 },
  { key: "internet", label: "Festnetz & Internet", slot: 7 },
  { key: "streaming", label: "Streaming & Abos", slot: 8 },
];
export const groupOf = (category) => GROUPS.find((g) => g.slot === CATEGORY_SLOT[category])?.key || "other";

export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const slotColor = (slot) => cssVar(`--series-${((slot - 1) % 8) + 1}`);
export const catSlot = (category) => CATEGORY_SLOT[category] || 8;
export const catColorVar = (category) => `var(--series-${catSlot(category)})`;
export const catColor = (category) => slotColor(catSlot(category));

export async function loadMeta() {
  if (!state.meta) state.meta = await api.meta();
  return state.meta;
}
export const category = (key) => state.meta?.categories.find((c) => c.key === key) || { key, label: key, icon: "📄", fields: [] };
export const catLabel = (key) => category(key).label;
export const catIcon = (key) => category(key).icon;
/** A contract's own emoji, else its category's. */
export const contractIcon = (c) => c.icon || catIcon(c.category);
export const intervalLabel = (key) => state.meta?.intervals[key]?.label || key;
export const isEnergy = (key) => !!category(key).energy;

export const STATE_LABEL = {
  active: { label: "Aktiv", cls: "good" },
  cancelled: { label: "Gekündigt", cls: "warn" },
  ended: { label: "Beendet", cls: "" },
  planned: { label: "Geplant", cls: "info" },
};
