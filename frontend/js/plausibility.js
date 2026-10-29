// Plausibility checks before a contract is saved: likely typos and values that don't fit together.
// Each finding names the form field it is about, so "Korrigieren" can jump there. Saving anyway is
// always possible – these are hints, not rules.

import { money } from "./ui.js";

// € per month above which a price is unusual for the category (without own contracts to compare)
const TYPICAL_MAX = {
  mobile: 120,
  internet: 150,
  streaming: 50,
  fitness: 150,
  electricity: 400,
  gas: 500,
  car_insurance: 250,
  legal_protection: 80,
  liability: 40,
  household: 80,
};
// mostly paid monthly: a small yearly amount is probably the monthly price
const MONTHLY_MARKETS = ["mobile", "internet", "streaming", "fitness"];
// § 309 Nr. 9 BGB (since 1 March 2022): at most 24 months, then monthly cancellable, notice at most one month
const FAIR_CONTRACTS = ["mobile", "internet", "streaming", "fitness"];
const FAIR_SINCE = "2022-03-01";

const de = (iso) => iso.split("-").reverse().join(".");

function noticeMonths(value, unit) {
  if (!value) return 0;
  if (unit === "days") return value / 30;
  if (unit === "weeks") return (value * 7) / 30;
  return value;
}

function median(values) {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * @param v       the form values: category, label, price, interval, months (of the interval), start,
 *                minTerm, renewal, noticeValue, noticeUnit, endDate, maxTotal, attrs, previousMonthly
 * @param others  the user's other contracts (summaries) – their prices are the yardstick
 * @returns       [{ field, text }]
 */
export function plausibilityIssues(v, others = []) {
  const issues = [];
  const add = (field, text) => issues.push({ field, text });
  const priceField = v.editing ? "attr_installment" : "price_amount";

  // ---- price
  if (v.price != null && !v.editing) {
    const monthly = v.price / (v.months || 1);
    const peers = others.filter((o) => o.category === v.category && o.full_monthly_cost > 0).map((o) => o.full_monthly_cost);
    const typical = median(peers);
    if (v.price === 0) {
      add(priceField, "Preis 0 € – ist der Vertrag wirklich kostenlos?");
    } else if (typical != null && monthly > typical * 8 && monthly > 30) {
      add(priceField, `${money(monthly)} im Monat ist ungewöhnlich viel – deine anderen Verträge unter „${v.label}“ kosten um ${money(typical)}. Komma vergessen (z. B. 12,99 statt 1299)?`);
    } else if (typical == null && TYPICAL_MAX[v.category] && monthly > TYPICAL_MAX[v.category]) {
      add(
        priceField,
        `${money(monthly)} im Monat ist für ${v.label} ungewöhnlich viel. Tippfehler – oder ist es ein Jahresbetrag? Dann die Zahlweise auf „jährlich“ stellen.`,
      );
    }
    if (MONTHLY_MARKETS.includes(v.category) && v.months === 12 && v.price < 30 && v.price > 0) {
      add("price_interval", `Nur ${money(v.price)} im Jahr? Das klingt nach dem Monatspreis – Zahlweise prüfen.`);
    }
  }
  if (v.editing && v.previousMonthly && v.newMonthly) {
    const r = v.newMonthly / v.previousMonthly;
    if (r > 3 || r < 1 / 3) add(priceField, `Der Abschlag ändert sich von ${money(v.previousMonthly)} auf ${money(v.newMonthly)} im Monat – stimmt der Betrag?`);
  }
  if (v.maxTotal && v.price && v.maxTotal < v.price) {
    add("max_total", `Die Gesamtsumme (${money(v.maxTotal)}) ist kleiner als eine einzige Zahlung (${money(v.price)}).`);
  }

  // ---- dates
  if (v.start) {
    const year = Number(v.start.slice(0, 4));
    const inAYear = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
    if (year < 1950) add("start_date", `Vertragsbeginn ${de(v.start)} – bitte die Jahreszahl prüfen.`);
    else if (v.start > inAYear) add("start_date", `Der Vertrag beginnt erst am ${de(v.start)} – über ein Jahr in der Zukunft. Jahreszahl prüfen?`);
    if (v.endDate && v.endDate < v.start) add("end_date", `Das Vertragsende (${de(v.endDate)}) liegt vor dem Beginn (${de(v.start)}).`);
  }

  // ---- term & notice
  const notice = noticeMonths(v.noticeValue, v.noticeUnit);
  if (v.minTerm > 0 && notice > v.minTerm) {
    add("notice_value", `Die Kündigungsfrist ist länger als die Mindestlaufzeit (${v.minTerm} ${v.minTerm === 1 ? "Monat" : "Monate"}) – stimmt das?`);
  }
  if (FAIR_CONTRACTS.includes(v.category) && v.start >= FAIR_SINCE) {
    const off = [];
    if (v.minTerm > 24) off.push(`Mindestlaufzeit ${v.minTerm} Monate (höchstens 24)`);
    if (v.renewal > 1) off.push(`Verlängerung um ${v.renewal} Monate (danach monatlich kündbar)`);
    if (notice > 1) off.push("Kündigungsfrist über einen Monat");
    if (off.length) {
      add(
        v.renewal > 1 ? "renewal_months" : v.minTerm > 24 ? "min_term_months" : "notice_value",
        `${off.join(", ")}: Bei Verträgen unter „${v.label}“, die ab dem 01.03.2022 geschlossen wurden, ist das so nicht mehr erlaubt (§ 309 Nr. 9 BGB). Steht das wirklich im Vertrag?`,
      );
    }
  }

  // ---- electricity & gas
  const a = v.attrs || {};
  const unit = Number(a.unit_price_ct) || null;
  if (unit != null && unit > 0 && unit < 1) add("attr_unit_price_ct", `Arbeitspreis ${String(unit).replace(".", ",")} ct/kWh – gemeint sind wohl ${Math.round(unit * 100)} Cent (in Cent eintragen).`);
  else if (unit > 100) add("attr_unit_price_ct", `Arbeitspreis ${unit} ct/kWh ist sehr hoch – Cent und Euro verwechselt?`);
  const base = Number(a.base_price_month) || null;
  if (base > 60) add("attr_base_price_month", `Grundpreis ${money(base)} im Monat – ist das der Jahresgrundpreis? Dann daneben „pro Jahr“ wählen.`);
  const kwh = Number(a.consumption_kwh) || null;
  if (kwh && v.category === "electricity" && (kwh < 300 || kwh > 25000)) add("attr_consumption_kwh", `Jahresverbrauch ${kwh} kWh ist ungewöhnlich für Strom (ein Haushalt liegt meist bei 1.500–5.000 kWh).`);
  const installment = v.newMonthly ?? (v.price != null ? v.price / (v.months || 1) : null);
  if (kwh && (base != null || unit != null) && installment) {
    const expected = (base || 0) * 12 + ((unit || 0) * kwh) / 100;
    const yearly = installment * 12;
    if (expected > 0 && yearly < expected * 0.75)
      add(priceField, `Der Abschlag deckt nur etwa ${Math.round((yearly / expected) * 100)} % der erwarteten Kosten – rund ${money(expected - yearly)} Nachzahlung im Jahr.`);
    else if (expected > 0 && yearly > expected * 1.4)
      add(priceField, `Der Abschlag liegt deutlich über den erwarteten Kosten – rund ${money(yearly - expected)} Guthaben im Jahr. Abschlag senken?`);
  }
  return issues;
}
