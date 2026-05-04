/**
 * Browser-side CSV parser. Reads a bank-statement CSV (date, description,
 * amount — or split debit/credit) and returns a RawStatement that the
 * existing `strip()` pipeline can consume.
 *
 * Universal: works with any bank that exports CSV (which is essentially
 * every modern bank globally). Replaces the fragile per-bank PDF parsers.
 *
 * Pure browser code: no Node `fs`, no pdfjs. Takes a `File` (or a string)
 * and returns a `RawStatement`. Mirror of `scripts/anonymise.ts`'s CSV
 * logic, but ESM-only and File-API-aware.
 */

import type { RawStatement, RawTransaction } from "./types.js";

/** Exposed so the UI can show users which header names the parser recognises. */
export const CSV_HEADER_ALIASES = {
  date: [
    "date", "datum", "buchungsdatum", "transaction date", "trans date",
    "posted date", "post date", "value date", "wertstellung", "valutadatum",
    "transactiondate",
  ],
  description: [
    "description", "memo", "verwendungszweck", "details", "reference",
    "narration", "particulars", "transaction", "beschreibung", "narrative",
    "transaction details", "memo description",
  ],
  amount: [
    "amount", "betrag", "amount eur", "amount zar", "amount usd",
    "amount gbp", "value", "transaction amount", "amount in account currency",
  ],
  debit: [
    "debit", "soll", "debit amount", "money out", "withdrawal", "withdrawals",
  ],
  credit: [
    "credit", "haben", "credit amount", "money in", "deposit", "deposits",
  ],
  type: ["type", "art", "transaction type", "dr cr", "kind"],
};

export class CsvParseError extends Error {
  constructor(
    message: string,
    public detectedHeaders: string[] = [],
    public missing: string[] = [],
  ) {
    super(message);
    this.name = "CsvParseError";
  }
}

/** Strip BOM, normalise lowercase + whitespace + parens for header matching. */
function normaliseHeader(h: string): string {
  return h
    .replace(/^﻿/, "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[€$£¥]/g, " ")
    .replace(/[_\-/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findHeader(normalised: string[], aliases: string[]): number {
  return normalised.findIndex((h) => aliases.includes(h));
}

/** Parse "1234.56" or "1.234,56" or "-89,00" → number. */
function parseAmount(s: string): number {
  const cleaned = s.replace(/\s|"/g, "").trim();
  if (!cleaned) return 0;
  if (/^-?\d{1,3}(\.\d{3})*,\d{1,2}$/.test(cleaned)) {
    return Number(cleaned.replace(/\./g, "").replace(",", "."));
  }
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
  // US-style "01/15/2024"
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (us) {
    let y = +us[3];
    if (y < 100) y += 2000;
    return new Date(Date.UTC(y, +us[1] - 1, +us[2]));
  }
  throw new Error(`unparseable date: ${s}`);
}

/**
 * Detect delimiter: comma, semicolon (German Excel default), or tab.
 * Picks whichever character is most consistent across the first 10 lines.
 */
function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 10);
  const candidates = [",", ";", "\t"];
  let best = ",";
  let bestScore = -1;
  for (const d of candidates) {
    const counts = sample.map((line) => line.split(d).length);
    if (counts.length === 0 || counts[0] < 2) continue;
    // Score: how consistent the column count is across lines
    const consistent = counts.every((c) => c === counts[0]);
    const score = consistent ? counts[0] * 10 : counts[0];
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** RFC-ish CSV row split with the chosen delimiter. */
function splitRow(line: string, delim: string): string[] {
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
    } else if (ch === delim && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

interface ParseOptions {
  /** Currency for the resulting RawStatement metadata. Default "EUR". */
  currency?: string;
  /** Optional bank-category hint passed through to the diagnostic. */
  bankIdentifier?: RawStatement["bankIdentifier"];
}

export interface CsvParseResult {
  statement: RawStatement;
  /** Rows the parser couldn't read. Surfaced to the UI for transparency. */
  skippedRowNumbers: number[];
}

/** Parse a CSV string into a RawStatement. */
export function parseCsvString(csv: string, opts: ParseOptions = {}): CsvParseResult {
  const stripped = csv.replace(/^﻿/, "");
  const lines = stripped
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) {
    throw new CsvParseError("CSV has no data rows (need at least a header + 1 transaction).");
  }

  const delim = detectDelimiter(stripped);
  const rawHeaders = splitRow(lines[0], delim);
  const headers = rawHeaders.map(normaliseHeader);

  const dateIdx = findHeader(headers, CSV_HEADER_ALIASES.date);
  const descIdx = findHeader(headers, CSV_HEADER_ALIASES.description);
  const amtIdx = findHeader(headers, CSV_HEADER_ALIASES.amount);
  const debitIdx = findHeader(headers, CSV_HEADER_ALIASES.debit);
  const creditIdx = findHeader(headers, CSV_HEADER_ALIASES.credit);
  const typeIdx = findHeader(headers, CSV_HEADER_ALIASES.type);

  const haveSplitDC = debitIdx >= 0 && creditIdx >= 0;
  const haveAmount = amtIdx >= 0;

  if (dateIdx < 0 || descIdx < 0 || (!haveAmount && !haveSplitDC)) {
    const missing: string[] = [];
    if (dateIdx < 0) missing.push("date");
    if (descIdx < 0) missing.push("description");
    if (!haveAmount && !haveSplitDC)
      missing.push("amount (or debit+credit pair)");
    throw new CsvParseError(
      `Could not auto-detect column(s): ${missing.join(", ")}. ` +
        `Open the CSV in a text editor and rename the relevant header(s) ` +
        `to one of the recognised names below, then upload again.`,
      rawHeaders,
      missing,
    );
  }

  const transactions: RawTransaction[] = [];
  const skipped: number[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = splitRow(lines[i], delim);
    try {
      let amount: number;
      if (haveAmount) {
        amount = parseAmount(cells[amtIdx] ?? "");
      } else {
        const debit = cells[debitIdx]
          ? parseAmount(cells[debitIdx])
          : 0;
        const credit = cells[creditIdx]
          ? parseAmount(cells[creditIdx])
          : 0;
        amount = Math.abs(credit) - Math.abs(debit);
      }
      const explicitType = (typeIdx >= 0 ? cells[typeIdx] ?? "" : "")
        .toLowerCase()
        .trim();
      const type: "inflow" | "outflow" =
        explicitType === "inflow" ||
        explicitType === "credit" ||
        explicitType === "haben" ||
        explicitType === "cr"
          ? "inflow"
          : explicitType === "outflow" ||
              explicitType === "debit" ||
              explicitType === "soll" ||
              explicitType === "dr"
            ? "outflow"
            : amount >= 0
              ? "inflow"
              : "outflow";
      transactions.push({
        date: parseDate(cells[dateIdx] ?? ""),
        valueDate: null,
        description: cells[descIdx] ?? "",
        counterpartyName: null,
        counterpartyIban: null,
        amount,
        type,
        reference: null,
      });
    } catch {
      // Footer summary rows ("Saldo: 12.345,67"), blank lines, etc. — skip.
      skipped.push(i + 1);
    }
  }

  if (transactions.length === 0) {
    throw new CsvParseError(
      "No transactions could be parsed from the CSV. " +
        "Check the file has at least a header row and one transaction row.",
      rawHeaders,
    );
  }

  const dates = transactions.map((t) => t.date.getTime());
  const periodStart = new Date(Math.min(...dates));
  const periodEnd = new Date(Math.max(...dates));

  const statement: RawStatement = {
    bankIdentifier: opts.bankIdentifier ?? "other",
    accountHolder: "REDACTED",
    iban: "XX00INVALID",
    bic: null,
    periodStart,
    periodEnd,
    startingBalance: 0,
    endingBalance: 0,
    currency: opts.currency ?? "EUR",
    transactions,
  };

  return { statement, skippedRowNumbers: skipped };
}

/** Parse a `File` (browser File API) into a RawStatement. */
export async function parseCsvFile(
  file: File,
  opts: ParseOptions = {},
): Promise<CsvParseResult> {
  const text = await file.text();
  return parseCsvString(text, opts);
}
