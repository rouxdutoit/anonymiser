/**
 * Sanitised diagnostic input — the JSON shape that crosses the trust
 * boundary into the worker. This is what Kimi K2.6 sees.
 *
 * Hard rules (enforced by `strip()` and validated by `paranoidCheck()`):
 *   - No names (person, company, organisation, vendor)
 *   - No IBANs, account numbers, BICs
 *   - No exact euro amounts (rounded to 2 significant figures)
 *   - No specific dates (only month/year)
 *   - No emails, phone numbers, URLs
 *   - No tax IDs, registration numbers, references, invoice numbers
 *   - No raw transaction memos (only category labels)
 *
 * Rationale for rounded amounts vs hard buckets: rounded magnitudes
 * (€4,237 → €4,200) let the diagnostic surface concrete findings
 * ("€4,200/month on overlapping SaaS that could be cut to €1,800")
 * while still satisfying "no exact figures ever leave the browser."
 * Round to 2 sig figs across all magnitudes; under €100, snap to nearest
 * 10 to avoid noise.
 *
 * Schema mirrors `/docs/sanitised-schema.md` v0.2.
 */

/**
 * An amount in EUR rounded to 2 significant figures. Always non-negative
 * (sign is captured by which field the amount lives in: inflow vs outflow).
 *
 * Examples: 4_200, 130_000, 90, 4_500_000.
 */
export type RoundedAmount = number;

export type RevenueBand = "under_5m" | "5_to_25m" | "25_to_100m" | "over_100m";
export type EmployeeBand = "under_20" | "20_to_50" | "50_to_200" | "over_200";

export type GrowthSignal = "growing" | "stable" | "declining" | "unclear";
export type Trend = "improving" | "worsening" | "stable" | "unclear";
export type NetDirection = "positive" | "negative" | "mixed";

export type Category =
  | "payroll"
  | "rent"
  | "insurance"
  | "software_saas"
  | "utility"
  | "professional_services"
  | "bank_fee"
  | "tax"
  | "transfer"
  | "uncategorised";

export interface MonthAmount {
  /** ISO year. */
  year: number;
  /** 1–12. */
  month: number;
  /** Total for the month, rounded to 2 sig figs. */
  amount: RoundedAmount;
}

export interface SanitisedDiagnosticInput {
  schemaVersion: "0.2";
  /** UUID generated client-side. Never persisted server-side. */
  analysisId: string;
  source: {
    type: "bank_statement";
    bankCategory: "sparkasse" | "commerzbank" | "deutsche_bank" | "dkb" | "other";
    periodDays: number;
  };
  companyShape: {
    revenueBand: RevenueBand;
    employeeBand: EmployeeBand | null;
    industryHint: string | null;
    seasonalityDetected: boolean;
    growthSignal: GrowthSignal;
  };
  cashFlow: {
    monthlyInflows: MonthAmount[];
    monthlyOutflows: MonthAmount[];
    netMonthlyDirection: NetDirection;
    largestInflowConcentrationPct: number;
    largestOutflowConcentrationPct: number;
  };
  customers: {
    distinctCustomerCount: number;
    top5RevenueConcentrationPct: number;
    top10RevenueConcentrationPct: number;
    longTailCount: number;
    averagePaymentDelayDaysEstimate: number | null;
    paymentDelayTrend: Trend;
  };
  suppliers: {
    distinctSupplierCount: number;
    top5SpendConcentrationPct: number;
    top10SpendConcentrationPct: number;
    longTailCount: number;
    paymentTermsConsistency: "consistent" | "inconsistent" | "unclear";
  };
  recurringSpend: {
    detectedSubscriptionCount: number;
    monthlyTotalRounded: RoundedAmount | null;
    categoryBreakdown: {
      category: Category;
      count: number;
      monthlyAvgRounded: RoundedAmount;
    }[];
    potentialOverlapsDetected: number;
  };
  operationalTax: {
    transactionCountTotal: number;
    smallTransactionCount: number;
    weekendTransactionCount: number;
  };
}
