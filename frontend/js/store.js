// Shared app state: metadata (categories, intervals) and category styling.

import { api } from "./api.js";

export const state = { meta: null, profile: null, dueCount: 0 };

// Fixed category -> color-slot mapping (color follows the entity, never its rank).
// Twelve categories share eight validated slots; related categories share a hue family.
const CATEGORY_SLOT = {
  mobile: 1,
  electricity: 2,
  car_insurance: 3,
  liability: 3,
  household: 3,
  legal_protection: 3,
  insurance: 3,
  gas: 4,
  streaming: 5,
  fitness: 6,
  internet: 7,
  other: 8,
};
export const GROUPS = [
  { key: "mobile", label: "Mobilfunk", slot: 1 },
  { key: "electricity", label: "Strom", slot: 2 },
  { key: "insurance", label: "Versicherungen", slot: 3 },
  { key: "gas", label: "Gas", slot: 4 },
  { key: "streaming", label: "Streaming & Abos", slot: 5 },
  { key: "fitness", label: "Fitness & Vereine", slot: 6 },
  { key: "internet", label: "Festnetz & Internet", slot: 7 },
  { key: "other", label: "Sonstiges", slot: 8 },
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
export const intervalLabel = (key) => state.meta?.intervals[key]?.label || key;
export const isEnergy = (key) => !!category(key).energy;

export const STATE_LABEL = {
  active: { label: "Aktiv", cls: "good" },
  cancelled: { label: "Gekündigt", cls: "warn" },
  ended: { label: "Beendet", cls: "" },
  planned: { label: "Geplant", cls: "info" },
};
