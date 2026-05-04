/**
 * Browser-side stripping pipeline. Takes a RawStatement (still has names,
 * IBANs, raw amounts) and produces a SanitisedDiagnosticInput suitable
 * for transmission to the worker.
 *
 * This is the most trust-critical code in the system. Every transformation
 * here must be deterministic, auditable in 30 minutes, and reject rather
 * than guess. The `paranoidCheck()` defense-in-depth scan catches anything
 * that slips through.
 *
 * Open-sourced at github.com/rouxdutoit/anonymiser.
 *
 * Amount handling: rounded to 2 significant figures. €4,237 → €4,200,
 * €127,453 → €130,000. Concrete enough for sharp findings, not exact
 * enough to constitute "raw amounts."
 */

import type { RawStatement, RawTransaction } from "./types.js";
import type {
  Category,
  MonthAmount,
  RevenueBand,
  RoundedAmount,
  SanitisedDiagnosticInput,
} from "./sanitised.js";

// -- Rounding ----------------------------------------------------------------

/**
 * Round a non-negative amount to `sig` significant figures.
 *
 *   roundToSig(4237, 2)     === 4200
 *   roundToSig(127453, 2)   === 130000
 *   roundToSig(89, 2)       === 89
 *   roundToSig(0, 2)        === 0
 *
 * Below 10, snaps to the nearest integer (no extra precision available).
 */
export function roundToSig(amount: number, sig = 2): RoundedAmount {
  if (!Number.isFinite(amount) || amount === 0) return 0;
  const abs = Math.abs(amount);
  if (abs < 10) return Math.round(abs);
  const magnitude = Math.floor(Math.log10(abs));
  const factor = Math.pow(10, magnitude - sig + 1);
  return Math.round(abs / factor) * factor;
}

function revenueBandFromAnnualised(periodInflow: number, periodDays: number): RevenueBand {
  const annualised = (periodInflow * 365) / Math.max(periodDays, 1);
  if (annualised < 5_000_000) return "under_5m";
  if (annualised < 25_000_000) return "5_to_25m";
  if (annualised < 100_000_000) return "25_to_100m";
  return "over_100m";
}

// -- Categorisation ----------------------------------------------------------

const CATEGORY_PATTERNS: Array<[Category, RegExp]> = [
  ["payroll", /\b(lohn|gehalt|bezug|salary|payroll)\b/i],
  ["rent", /\b(miete|pacht|rent|nebenkosten)\b/i],
  ["insurance", /\b(versicherung|allianz|axa|huk|gothaer|generali)\b/i],
  ["software_saas", /\b(microsoft|adobe|atlassian|github|aws|google\s?cloud|cloudflare|datev|sap|notion|slack|zoom|stripe|shopify|salesforce)\b/i],
  ["utility", /\b(telekom|vodafone|stadtwerke|strom|gas|wasser|gez|rundfunkbeitrag)\b/i],
  ["professional_services", /\b(steuer|rechtsanw|notar|berater|wirtschaftspr|kanzlei|consulting)\b/i],
  ["bank_fee", /\b(gebühr|gebuehr|entgelt|provision|spesen|kontoführ)\b/i],
  ["tax", /\b(finanzamt|umsatzsteuer|gewerbe|körperschaft|koerperschaft|lohnsteuer)\b/i],
  ["transfer", /\b(übertrag|uebertrag|umbuchung|interner\s+transfer)\b/i],
];

function stripPii(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/(?:\+49|0049|0)\s?\d{2,4}[\s\d]{6,}/g, "[phone]")
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/[A-Z]{2}\d{2}\s?(?:\d{4}\s?){3,5}\d{0,4}/g, "[iban]");
}

function categorise(memo: string): Category {
  const cleaned = stripPii(memo);
  for (const [cat, re] of CATEGORY_PATTERNS) {
    if (re.test(cleaned)) return cat;
  }
  return "uncategorised";
}

// -- Counterparty pseudonymisation -------------------------------------------

function buildCounterpartyMap(transactions: RawTransaction[]): Map<string, string> {
  const map = new Map<string, string>();
  let inflowIdx = 0;
  let outflowIdx = 0;
  for (const t of transactions) {
    const key = (t.counterpartyName ?? extractFallbackKey(t.description) ?? "").toLowerCase().trim();
    if (!key || map.has(key)) continue;
    if (t.type === "inflow") {
      map.set(key, `Customer_${labelFromIdx(inflowIdx++)}`);
    } else {
      map.set(key, `Supplier_${labelFromIdx(outflowIdx++)}`);
    }
  }
  return map;
}

function extractFallbackKey(memo: string): string | null {
  const cleaned = stripPii(memo).split(/\n/)[0].trim().slice(0, 30);
  return cleaned || null;
}

function labelFromIdx(i: number): string {
  if (i < 26) return String.fromCharCode(65 + i);
  return String.fromCharCode(65 + Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26));
}

// -- Concentration & monthly aggregation -------------------------------------

function topNConcentrationPct(amountsByKey: Map<string, number>, n: number): number {
  const sorted = [...amountsByKey.values()].map(Math.abs).sort((a, b) => b - a);
  const total = sorted.reduce((s, v) => s + v, 0);
  if (total === 0) return 0;
  const topN = sorted.slice(0, n).reduce((s, v) => s + v, 0);
  return Math.round((topN / total) * 100);
}

function monthlyAmounts(
  transactions: RawTransaction[],
  filter: (t: RawTransaction) => boolean,
): MonthAmount[] {
  const byMonth = new Map<string, number>();
  for (const t of transactions) {
    if (!filter(t)) continue;
    const y = t.date.getUTCFullYear();
    const m = t.date.getUTCMonth() + 1;
    const key = `${y}-${m}`;
    byMonth.set(key, (byMonth.get(key) ?? 0) + Math.abs(t.amount));
  }
  return [...byMonth.entries()]
    .map(([k, v]) => {
      const [y, m] = k.split("-").map(Number);
      return { year: y, month: m, amount: roundToSig(v, 2) };
    })
    .sort((a, b) => a.year - b.year || a.month - b.month);
}

// -- Recurring detection ----------------------------------------------------

function detectRecurring(transactions: RawTransaction[]): {
  count: number;
  byCategory: Map<Category, { count: number; total: number }>;
} {
  const buckets = new Map<string, { txs: RawTransaction[]; cat: Category }>();
  for (const t of transactions) {
    if (t.type !== "outflow") continue;
    const key = `${(t.counterpartyName ?? extractFallbackKey(t.description) ?? "").toLowerCase().trim()}|${Math.round(Math.abs(t.amount))}`;
    const cat = categorise(t.description);
    const slot = buckets.get(key) ?? { txs: [], cat };
    slot.txs.push(t);
    buckets.set(key, slot);
  }
  let count = 0;
  const byCategory = new Map<Category, { count: number; total: number }>();
  for (const slot of buckets.values()) {
    if (slot.txs.length < 3) continue;
    count += 1;
    const totalMonthly = slot.txs.reduce((s, t) => s + Math.abs(t.amount), 0) / Math.max(slot.txs.length, 1);
    const prev = byCategory.get(slot.cat) ?? { count: 0, total: 0 };
    prev.count += 1;
    prev.total += totalMonthly;
    byCategory.set(slot.cat, prev);
  }
  return { count, byCategory };
}

// -- Main entry point --------------------------------------------------------

function uuid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

export function strip(statement: RawStatement): SanitisedDiagnosticInput {
  const periodDays = Math.max(
    1,
    Math.round(
      (statement.periodEnd.getTime() - statement.periodStart.getTime()) / (1000 * 60 * 60 * 24),
    ),
  );

  const cpMap = buildCounterpartyMap(statement.transactions);
  const cpAmount = (t: RawTransaction): { key: string; amount: number } => {
    const raw = (t.counterpartyName ?? extractFallbackKey(t.description) ?? "").toLowerCase().trim();
    return { key: cpMap.get(raw) ?? "Unknown", amount: t.amount };
  };

  const customerAmounts = new Map<string, number>();
  const supplierAmounts = new Map<string, number>();
  let totalInflow = 0;
  let totalOutflow = 0;
  let weekendCount = 0;
  let smallCount = 0;
  for (const t of statement.transactions) {
    const { key, amount } = cpAmount(t);
    if (t.type === "inflow") {
      customerAmounts.set(key, (customerAmounts.get(key) ?? 0) + amount);
      totalInflow += amount;
    } else {
      supplierAmounts.set(key, (supplierAmounts.get(key) ?? 0) + Math.abs(amount));
      totalOutflow += Math.abs(amount);
    }
    const dow = t.date.getUTCDay();
    if (dow === 0 || dow === 6) weekendCount += 1;
    if (Math.abs(amount) < 100) smallCount += 1;
  }

  const recurring = detectRecurring(statement.transactions);

  const monthlyIn = monthlyAmounts(statement.transactions, (t) => t.type === "inflow");
  const monthlyOut = monthlyAmounts(statement.transactions, (t) => t.type === "outflow");

  // Net direction: positive if inflow exceeds outflow each month.
  const netSignals = monthlyIn.map((m, i) => {
    const out = monthlyOut[i]?.amount ?? 0;
    return m.amount >= out ? "positive" : "negative";
  });
  const netMonthlyDirection: SanitisedDiagnosticInput["cashFlow"]["netMonthlyDirection"] =
    netSignals.length === 0
      ? "mixed"
      : netSignals.every((s) => s === "positive")
        ? "positive"
        : netSignals.every((s) => s === "negative")
          ? "negative"
          : "mixed";

  const longTail = (m: Map<string, number>, total: number) => {
    if (total === 0) return 0;
    let n = 0;
    for (const v of m.values()) {
      if (Math.abs(v) / total < 0.02) n += 1;
    }
    return n;
  };

  const customerTop5 = topNConcentrationPct(customerAmounts, 5);
  const customerTop10 = topNConcentrationPct(customerAmounts, 10);
  const supplierTop5 = topNConcentrationPct(supplierAmounts, 5);
  const supplierTop10 = topNConcentrationPct(supplierAmounts, 10);

  return {
    schemaVersion: "0.2",
    analysisId: uuid(),
    source: {
      type: "bank_statement",
      bankCategory: statement.bankIdentifier,
      periodDays,
    },
    companyShape: {
      revenueBand: revenueBandFromAnnualised(totalInflow, periodDays),
      employeeBand: null, // TODO: estimate from payroll patterns
      industryHint: null, // TODO: derive from supplier/customer category mix
      seasonalityDetected: monthlyIn.length >= 3 && hasSeasonality(monthlyIn),
      growthSignal: deriveGrowthSignal(monthlyIn),
    },
    cashFlow: {
      monthlyInflows: monthlyIn,
      monthlyOutflows: monthlyOut,
      netMonthlyDirection,
      largestInflowConcentrationPct:
        customerAmounts.size > 0 ? topNConcentrationPct(customerAmounts, 1) : 0,
      largestOutflowConcentrationPct:
        supplierAmounts.size > 0 ? topNConcentrationPct(supplierAmounts, 1) : 0,
    },
    customers: {
      distinctCustomerCount: customerAmounts.size,
      top5RevenueConcentrationPct: customerTop5,
      top10RevenueConcentrationPct: customerTop10,
      longTailCount: longTail(customerAmounts, totalInflow),
      averagePaymentDelayDaysEstimate: null, // TODO
      paymentDelayTrend: "unclear",
    },
    suppliers: {
      distinctSupplierCount: supplierAmounts.size,
      top5SpendConcentrationPct: supplierTop5,
      top10SpendConcentrationPct: supplierTop10,
      longTailCount: longTail(supplierAmounts, totalOutflow),
      paymentTermsConsistency: "unclear",
    },
    recurringSpend: {
      detectedSubscriptionCount: recurring.count,
      monthlyTotalRounded:
        recurring.count > 0
          ? roundToSig(
              [...recurring.byCategory.values()].reduce((s, v) => s + v.total, 0),
            )
          : null,
      categoryBreakdown: [...recurring.byCategory.entries()].map(([category, v]) => ({
        category,
        count: v.count,
        monthlyAvgRounded: roundToSig(v.total / Math.max(v.count, 1)),
      })),
      potentialOverlapsDetected: countOverlapCategories(recurring.byCategory),
    },
    operationalTax: {
      transactionCountTotal: statement.transactions.length,
      smallTransactionCount: smallCount,
      weekendTransactionCount: weekendCount,
    },
  };
}

function hasSeasonality(monthly: MonthAmount[]): boolean {
  if (monthly.length < 3) return false;
  const amounts = monthly.map((m) => m.amount).filter((v) => v > 0);
  if (amounts.length < 3) return false;
  const max = Math.max(...amounts);
  const min = Math.min(...amounts);
  // 2× variation across months → likely seasonal.
  return max >= 2 * min;
}

function deriveGrowthSignal(monthly: MonthAmount[]): SanitisedDiagnosticInput["companyShape"]["growthSignal"] {
  if (monthly.length < 2) return "unclear";
  const first = monthly[0].amount;
  const last = monthly[monthly.length - 1].amount;
  if (first === 0 && last === 0) return "unclear";
  // 10% threshold so noise doesn't flip the signal.
  if (last > first * 1.1) return "growing";
  if (last < first * 0.9) return "declining";
  return "stable";
}

function countOverlapCategories(
  byCategory: Map<Category, { count: number; total: number }>,
): number {
  let n = 0;
  for (const v of byCategory.values()) {
    if (v.count >= 2) n += 1;
  }
  return n;
}
