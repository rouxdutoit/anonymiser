#!/usr/bin/env bun
/**
 * Off-funnel anonymiser CLI.
 *
 * Reads a CSV of transactions, applies the same deterministic stripping
 * rules as the public funnel at rouxdutoit.com (see /parsers/src/strip.ts),
 * and writes the sanitised JSON. Runs entirely on the operator's machine.
 * No network calls. No LLMs. No data leaves until the operator decides
 * to send the resulting JSON.
 *
 * Use case: a customer outside the public funnel (unsupported bank, etc.)
 * provides transactions as CSV; this script anonymises them locally so
 * only the sanitised JSON is shared with Roux.
 *
 * Usage:
 *   bun scripts/anonymise.ts <transactions.csv> [--cc <cc.csv>] \
 *     [--currency ZAR] [--hint "<company hint>"] [-o <out.json>]
 *
 * CSV format (headers required, case-insensitive):
 *   date,description,amount[,type]
 *   2024-01-15,"Stripe Auszahlung",2500.00
 *   2024-01-16,"Lieferant Müller GmbH",-450.00
 *
 *   - date: ISO YYYY-MM-DD or DE-style DD.MM.YYYY
 *   - amount: positive for inflows, negative for outflows. Decimal with
 *     period (1234.56) or German comma (1.234,56) — both accepted.
 *   - type: optional "inflow"/"outflow"; if omitted, derived from sign.
 *   - Both ZAR/EUR/etc. work — currency is metadata, the diagnostic uses
 *     ratios and rounded amounts.
 *
 * The output is written to stdout by default, or to a file with `-o`.
 * A transparency summary is written to stderr so you can verify what
 * was stripped before sending the JSON anywhere.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { argv, exit, stderr, stdout } from "node:process";
import { strip } from "./parsers/src/strip.js";
import { paranoidCheck } from "./parsers/src/paranoid-check.js";
import type { RawStatement, RawTransaction } from "./parsers/src/types.js";

interface Args {
  inputPath: string;
  ccPath?: string;
  currency: string;
  hint?: string;
  outputPath?: string;
}

function usage(): never {
  stderr.write(
    "usage: bun scripts/anonymise.ts <transactions.csv> " +
      "[--cc <cc.csv>] [--currency XXX] [--hint \"<text>\"] [-o <out.json>]\n",
  );
  exit(1);
}

function parseArgs(): Args {
  const args = argv.slice(2);
  if (args.length === 0) usage();
  let inputPath: string | undefined;
  let ccPath: string | undefined;
  let currency = "EUR";
  let hint: string | undefined;
  let outputPath: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--cc") ccPath = args[++i];
    else if (a === "--currency") currency = args[++i];
    else if (a === "--hint") hint = args[++i];
    else if (a === "-o" || a === "--out") outputPath = args[++i];
    else if (a === "--help" || a === "-h") usage();
    else if (!inputPath) inputPath = a;
    else {
      stderr.write(`Unexpected argument: ${a}\n`);
      usage();
    }
  }
  if (!inputPath) usage();
  return { inputPath, ccPath, currency, hint, outputPath };
}

/** Parse "1234.56" or "1.234,56" or "-89,00" → number. */
function parseAmount(s: string): number {
  const cleaned = s.replace(/\s|"/g, "").trim();
  if (!cleaned) return 0;
  // German style: digits, period as thousands, comma as decimal.
  if (/^-?\d{1,3}(\.\d{3})*,\d{1,2}$/.test(cleaned)) {
    return Number(cleaned.replace(/\./g, "").replace(",", "."));
  }
  // International: period decimal, optional thousand separators (comma).
  return Number(cleaned.replace(/,/g, ""));
}

/** Parse "2024-01-15" or "15.01.2024" or "15.01.24" → Date (UTC). */
function parseDate(s: string): Date {
  const trimmed = s.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
  const de = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  if (de) {
    let y = +de[3];
    if (y < 100) y += 2000;
    return new Date(Date.UTC(y, +de[2] - 1, +de[1]));
  }
  throw new Error(`unparseable date: ${s}`);
}

/** Minimal RFC-ish CSV row split. Handles "quoted, fields" with commas. */
function splitCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

interface ParsedCsv {
  rows: { date: Date; description: string; amount: number; type: "inflow" | "outflow" }[];
}

/**
 * Header aliases. Headers are first normalised (lowercased, parens
 * stripped, whitespace collapsed) so e.g. "Amount (ZAR)" → "amount" and
 * "Transaction Date" → "transaction date".
 */
const HEADER_ALIASES = {
  date: [
    "date", "datum", "buchungsdatum", "transaction date", "trans date",
    "posted date", "post date", "value date", "wertstellung", "valutadatum",
    "transactiondate",
  ],
  description: [
    "description", "memo", "verwendungszweck", "details", "reference",
    "narration", "particulars", "transaction", "beschreibung", "narrative",
    "transaction details", "memo / description",
  ],
  amount: [
    "amount", "betrag", "amount eur", "amount zar", "amount usd",
    "amount gbp", "value", "transaction amount", "amount in account currency",
  ],
  debit: ["debit", "soll", "debit amount", "money out", "withdrawal", "withdrawals"],
  credit: ["credit", "haben", "credit amount", "money in", "deposit", "deposits"],
  type: ["type", "art", "transaction type", "dr/cr", "kind"],
};

/** Normalise a header for matching: lowercase, drop parens content, trim. */
function normaliseHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")    // "Amount (ZAR)" → "amount  "
    .replace(/[€$£¥]/g, " ")     // strip currency symbols
    .replace(/[_\-/]/g, " ")     // separators → space
    .replace(/\s+/g, " ")        // collapse whitespace
    .trim();
}

function findHeader(normalised: string[], aliases: string[]): number {
  return normalised.findIndex((h) => aliases.includes(h));
}

function readCsv(path: string): ParsedCsv {
  const raw = readFileSync(resolve(path), "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error(`CSV has no data rows: ${path}`);
  const rawHeaders = splitCsvRow(lines[0]);
  const headers = rawHeaders.map(normaliseHeader);

  const dateIdx = findHeader(headers, HEADER_ALIASES.date);
  const descIdx = findHeader(headers, HEADER_ALIASES.description);
  const amtIdx = findHeader(headers, HEADER_ALIASES.amount);
  const debitIdx = findHeader(headers, HEADER_ALIASES.debit);
  const creditIdx = findHeader(headers, HEADER_ALIASES.credit);
  const typeIdx = findHeader(headers, HEADER_ALIASES.type);

  // Validate: need date, description, and either amount OR (debit AND credit).
  const haveSplitDC = debitIdx >= 0 && creditIdx >= 0;
  const haveAmount = amtIdx >= 0;
  if (dateIdx < 0 || descIdx < 0 || (!haveAmount && !haveSplitDC)) {
    const missing: string[] = [];
    if (dateIdx < 0) missing.push("date");
    if (descIdx < 0) missing.push("description");
    if (!haveAmount && !haveSplitDC)
      missing.push("amount (or debit+credit pair)");
    throw new Error(
      `Could not auto-detect column(s): ${missing.join(", ")}.\n` +
        `   Detected headers: ${rawHeaders.map((h) => `"${h}"`).join(", ")}\n` +
        `   Recognised aliases: ${JSON.stringify(HEADER_ALIASES, null, 2)}\n` +
        `   Fix: rename your CSV's header row to use one of the recognised\n` +
        `   names (e.g. rename "Trans Date" to "date"), or open an issue\n` +
        `   at github.com/rouxdutoit/anonymiser with your bank's format.`,
    );
  }

  const rows: ParsedCsv["rows"] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvRow(lines[i]);
    try {
      let amount: number;
      if (haveAmount) {
        amount = parseAmount(cells[amtIdx]);
      } else {
        // Split debit/credit columns: typically one of the two is empty per row.
        const debit = cells[debitIdx] ? parseAmount(cells[debitIdx]) : 0;
        const credit = cells[creditIdx] ? parseAmount(cells[creditIdx]) : 0;
        // Convention: credit is positive (inflow), debit is negative (outflow).
        // If a bank publishes both as positive numbers, signs are derived here.
        amount = Math.abs(credit) - Math.abs(debit);
      }
      const explicitType =
        typeIdx >= 0 ? cells[typeIdx].toLowerCase().trim() : "";
      const type: "inflow" | "outflow" =
        explicitType === "inflow" || explicitType === "credit" || explicitType === "haben" || explicitType === "cr"
          ? "inflow"
          : explicitType === "outflow" || explicitType === "debit" || explicitType === "soll" || explicitType === "dr"
            ? "outflow"
            : amount >= 0
              ? "inflow"
              : "outflow";
      rows.push({
        date: parseDate(cells[dateIdx]),
        description: cells[descIdx],
        amount,
        type,
      });
    } catch (err) {
      stderr.write(`  ! row ${i + 1} skipped: ${(err as Error).message}\n`);
    }
  }
  return { rows };
}

function buildRawStatement(
  rows: ParsedCsv["rows"],
  currency: string,
): RawStatement {
  if (rows.length === 0) {
    throw new Error("no transactions parsed — check the CSV format");
  }
  const dates = rows.map((r) => r.date.getTime());
  const periodStart = new Date(Math.min(...dates));
  const periodEnd = new Date(Math.max(...dates));
  const transactions: RawTransaction[] = rows.map((r) => ({
    date: r.date,
    valueDate: null,
    description: r.description,
    counterpartyName: null, // strip() will pseudonymise from description
    counterpartyIban: null,
    amount: r.amount,
    type: r.type,
    reference: null,
  }));
  return {
    bankIdentifier: "other",
    accountHolder: "REDACTED",
    iban: "XX00INVALID",
    bic: null,
    periodStart,
    periodEnd,
    startingBalance: 0,
    endingBalance: 0,
    currency,
    transactions,
  };
}

function summary(
  inputs: { bank: number; cc: number },
  out: ReturnType<typeof strip>,
): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("=== Transparency summary ===");
  lines.push(
    `Input:           ${inputs.bank} bank tx${inputs.cc ? ` + ${inputs.cc} credit-card tx` : ""}`,
  );
  lines.push(`Output schema:   ${out.schemaVersion}`);
  lines.push(`Total tx kept:   ${out.operationalTax.transactionCountTotal}`);
  lines.push("");
  lines.push("Stripped before output:");
  lines.push("  - all account holder names");
  lines.push("  - all IBANs / account numbers");
  lines.push("  - all vendor / counterparty names");
  lines.push("  - all exact amounts (rounded to 2 sig figs)");
  lines.push("  - all specific dates (kept only month/year aggregations)");
  lines.push("  - all transaction memos (only category labels remain)");
  lines.push("");
  lines.push("Inflow buckets per month:  " + out.cashFlow.monthlyInflows.length);
  lines.push("Outflow buckets per month: " + out.cashFlow.monthlyOutflows.length);
  lines.push("Distinct customer count:   " + out.customers.distinctCustomerCount);
  lines.push("Distinct supplier count:   " + out.suppliers.distinctSupplierCount);
  lines.push("Recurring subscriptions:   " + out.recurringSpend.detectedSubscriptionCount);
  lines.push("");
  lines.push("Review the output JSON before sending. Nothing has been");
  lines.push("transmitted from this machine yet.");
  lines.push("");
  return lines.join("\n");
}

function main() {
  const args = parseArgs();
  const bank = readCsv(args.inputPath);
  const cc = args.ccPath ? readCsv(args.ccPath) : { rows: [] };

  // Combine bank + credit card transactions; strip() handles the merge.
  const combined = [...bank.rows, ...cc.rows].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );

  const rawStatement = buildRawStatement(combined, args.currency);
  const sanitised = strip(rawStatement);
  const check = paranoidCheck(sanitised);

  if (!check.safe) {
    stderr.write("\nERROR: paranoid check FAILED. Issues:\n");
    for (const iss of check.issues) stderr.write(`  - ${iss}\n`);
    stderr.write("\nNot writing output. Open an issue at\n");
    stderr.write("github.com/rouxdutoit/anonymiser if this looks wrong.\n");
    exit(2);
  }

  const json = JSON.stringify(sanitised, null, 2) + "\n";

  // Optional metadata hint passed through to the diagnostic prompt downstream.
  // Note: hint is captured separately rather than baked into the schema so
  // schema validation stays strict.
  if (args.hint) {
    stderr.write(`Hint to include when sending: "${args.hint}"\n`);
  }

  if (args.outputPath) {
    writeFileSync(resolve(args.outputPath), json);
    stderr.write(`Wrote ${args.outputPath}\n`);
  } else {
    stdout.write(json);
  }

  stderr.write(summary({ bank: bank.rows.length, cc: cc.rows.length }, sanitised));
}

main();
