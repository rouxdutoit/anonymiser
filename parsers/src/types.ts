/**
 * Shared types for the bank-statement parsers.
 *
 * These run in the browser. The privacy claim depends on parsing happening
 * client-side and being deterministic + auditable. No server roundtrips.
 */

export type BankIdentifier =
  | "sparkasse"
  | "commerzbank"
  | "deutsche_bank"
  | "dkb"
  | "other";

/**
 * A single bank statement transaction, raw — pre-anonymisation.
 * Names, IBANs, and amounts are still present at this stage.
 */
export interface RawTransaction {
  /** Booking date (Buchungstag). */
  date: Date;
  /** Value date (Wertstellung). May equal `date`. */
  valueDate: Date | null;
  /** Full memo / Verwendungszweck, multi-line concatenated to a single string. */
  description: string;
  /** Counterparty name parsed from memo if available. */
  counterpartyName: string | null;
  /** Counterparty IBAN parsed from memo if available. */
  counterpartyIban: string | null;
  /** Negative for outflow, positive for inflow. EUR for v1 banks. */
  amount: number;
  type: "inflow" | "outflow";
  /** End-to-end reference / Mandatsreferenz if present. */
  reference: string | null;
}

export interface RawStatement {
  bankIdentifier: BankIdentifier;
  /** Account holder line as printed on the statement. Stripped before transmission. */
  accountHolder: string;
  /** Account IBAN. Stripped before transmission. */
  iban: string;
  bic: string | null;
  /** Statement period start (inclusive). */
  periodStart: Date;
  /** Statement period end (inclusive). */
  periodEnd: Date;
  startingBalance: number;
  endingBalance: number;
  currency: "EUR" | string;
  transactions: RawTransaction[];
}

export interface BankParser {
  bankIdentifier: BankIdentifier;
  /** Quick textual heuristic — does this PDF look like our bank? */
  detect(pdfText: string): boolean;
  /** Extract structured data. Throws if the format genuinely doesn't match. */
  parse(pdfBuffer: ArrayBuffer): Promise<RawStatement>;
}

export interface ParseSuccess {
  status: "ok";
  statement: RawStatement;
}

export interface ParseUnsupported {
  status: "unsupported_format";
  /** What we tried — for debugging in the browser console only. */
  attempted: BankIdentifier[];
}

export interface ParseError {
  status: "parse_error";
  bankIdentifier: BankIdentifier;
  message: string;
}

export type ParseResult = ParseSuccess | ParseUnsupported | ParseError;
