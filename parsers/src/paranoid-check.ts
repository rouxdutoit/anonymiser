/**
 * Defense-in-depth scan over the sanitised JSON before transmission.
 * If anything that looks like raw PII or an exact (non-rounded) amount
 * slips through the strip pipeline, this catches it.
 *
 * The browser refuses to POST if `safe === false`. The same check runs
 * server-side in the worker as a second gate.
 */

import type { SanitisedDiagnosticInput } from "./sanitised.js";

export interface ParanoidResult {
  safe: boolean;
  issues: string[];
}

export function paranoidCheck(input: SanitisedDiagnosticInput): ParanoidResult {
  const json = JSON.stringify(input);
  const issues: string[] = [];

  // IBAN-shaped sequences (e.g. DE89 3704 0044 0532 0130 00).
  if (/\b[A-Z]{2}\d{2}\s?(?:\d{4}\s?){3,5}\d{0,4}\b/.test(json)) {
    issues.push("Possible IBAN-like sequence found");
  }

  // Email
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(json)) {
    issues.push("Possible email address found");
  }

  // German phone numbers
  if (/(?:\+49|0049|0)\s?\d{2,4}[\s\d]{6,}/.test(json)) {
    issues.push("Possible phone number found");
  }

  // URLs
  if (/https?:\/\/\S+/.test(json)) {
    issues.push("Possible URL found");
  }

  // Long numeric sequences (account numbers, references, tax IDs).
  // Rounded amounts have trailing zeros, so a non-zero digit in the last
  // position of a 10+ digit run is suspicious.
  if (/\b\d{0,9}[1-9]\d{9,}\b/.test(json)) {
    issues.push("Long numeric sequence with non-zero trailing digit");
  }

  // Cents/decimals: schema only emits integers (rounded to 2 sig figs).
  // Match currency-shaped decimals — at least 2 digits before, exactly 2
  // after — so legitimate version strings like "schemaVersion: 0.2"
  // don't trip the check.
  if (/\b\d{2,}[,.]\d{2}\b/.test(json)) {
    issues.push("Decimal-formatted number found (amounts must be rounded integers)");
  }

  return { safe: issues.length === 0, issues };
}
