# Anonymiser — open-source anonymisation rules powering rouxdutoit.com

This repository holds the **deterministic anonymisation rules** that protect customer data on the [Operative Diagnose](https://rouxdutoit.com) public funnel. Public so anyone can read the code and verify exactly what gets stripped before any data leaves the browser.

---

## For most users: just use the website

Almost every modern bank exports CSV from online banking — that's all you need.

1. **Export your last 90+ days as CSV** from your bank's online banking (look for "Umsätze → Export → CSV" or similar).
2. **Open [rouxdutoit.com/diagnose](https://rouxdutoit.com/diagnose)** in your browser.
3. **Drop the CSV file** on the upload zone.
4. **Review the payload preview** — the page shows you exactly what's about to be sent (rounded numbers, no names, no IBANs).
5. **Click *Confirm and send*.**
6. **The 8-page diagnostic appears in ~60 seconds** as a downloadable PDF.

Everything between step 3 and step 5 happens entirely in your browser — the same anonymisation rules from this repository, running locally on your computer. Nothing reaches our server until you explicitly confirm.

If you have a credit-card statement export, you can drop that alongside the bank CSV in the same upload — the diagnostic gets sharper with more data.

**That's the whole flow for ~99% of users.** The rest of this README is for two narrower audiences.

---

## For auditors and the privacy-curious

The anonymisation logic lives in three short files you can read in 30 minutes:

| File | What it does |
|---|---|
| [`parsers/src/csv-parser.ts`](./parsers/src/csv-parser.ts) | Reads the CSV. Auto-detects column names across most banks (date / description / amount, also debit + credit pairs). |
| [`parsers/src/strip.ts`](./parsers/src/strip.ts) | The actual anonymisation: pseudonymises counterparties, rounds amounts to 2 significant figures, buckets dates to month/year, categorises memos and discards the raw text, computes ratios and concentrations. |
| [`parsers/src/paranoid-check.ts`](./parsers/src/paranoid-check.ts) | Defence-in-depth scan over the output. Refuses to emit JSON containing IBAN-shaped sequences, emails, phones, URLs, exact decimals, or long unstructured numbers. |

Schema reference: [`parsers/src/sanitised.ts`](./parsers/src/sanitised.ts). Hard rules:
- No names (person, company, vendor)
- No IBANs / account numbers / BICs
- No exact amounts — rounded to 2 significant figures (€4,237 → €4,200)
- No specific dates — only month/year aggregations
- No emails / phones / URLs
- No raw memos — only category labels (`software_saas`, `payroll`, `rent`, etc.)

Customer's IT team should be able to read these files and verify the rules match the privacy claim on rouxdutoit.com/privat. Open an issue on GitHub if you find a leak.

---

## For users whose bank doesn't export CSV (rare fallback)

Some private banks and a few small cooperative banks only do PDF statements. If that's you, you can run the anonymiser locally on your computer using a vision model to extract transactions from the PDF first. About 25 minutes the first time, ~5 minutes for any subsequent runs.

This route involves installing two pieces of software (LM Studio and `bun`). If you'd rather not, message Roux directly — for trusted off-funnel customers, he can handle a different secure handoff.

### Before you start

- **RAM:** roughly 16 GB or more.
- **Disk:** ~6 GB free (5 GB for the language model, the rest for the script).
- **OS:** macOS, Windows, or Linux. Apple Silicon Macs are particularly fast at this.

### Part 1 — Convert your bank PDF to a CSV using LM Studio

#### 1. Download LM Studio (~3 minutes)

Go to [lmstudio.ai](https://lmstudio.ai), download the installer for your OS, install like any normal app.

#### 2. Open LM Studio for the first time (~1 minute)

Launch it. Skip the welcome / onboarding. You'll know you're set when you see icons in the left sidebar (magnifying glass, chat bubble, folder).

#### 3. Search for the model (~2 minutes)

Click the **magnifying-glass** icon (Discover tab). Search:

```
Qwen2.5-VL-7B-Instruct
```

Pick the result tagged **`Q4_K_M`** (or anything with `Q4`). About 5 GB.

#### 4. Download the model (~5–10 minutes — coffee break)

Click **Download**. Walk away while it downloads. It runs in the background.

#### 5. Load the model (~1 minute)

Click the **chat-bubble** icon (Chat tab). At the top, click **Select a model to load** and pick the Qwen model. Wait ~10 seconds for it to load into RAM.

#### 6. Attach your bank statement PDF (~30 seconds)

In the chat input, click the **paperclip** icon and select your bank statement PDF.

#### 7. Paste the extraction prompt (~1 minute)

Copy the entire block below and paste it as your message:

```
This is a bank statement. Extract every transaction as a CSV with exactly these columns:

date,description,amount

Rules:
- One row per transaction. Header row included.
- date: ISO format YYYY-MM-DD
- description: the full memo, single line, no extra commas (replace any internal comma with a semicolon)
- amount: positive for money in (deposits, customer payments). Negative for money out (payments, fees, transfers out). Decimal with a period (e.g. 1234.56), no thousand separators.

Return only the CSV. No commentary, no markdown fences, no backticks.
```

Press send.

#### 8. Spot-check the result (~1–2 minutes)

The model writes the CSV. Verify 3–4 random rows against the PDF: dates align, amounts match, signs are correct. If anything looks off, ask the model to redo specific rows.

#### 9. Save the CSV to your Desktop (~1 minute)

Highlight the CSV (from `date,description,amount` to the last row), copy it, paste into a plain-text editor (TextEdit on macOS — *Format → Make Plain Text* — or Notepad on Windows), save as `bank.csv` on your Desktop.

Optional: repeat for a credit-card statement and save as `cc.csv`.

> **Easier alternative once you have the CSV:** at this point you can stop following this guide and just **drop your `bank.csv` (and optionally `cc.csv`) on [rouxdutoit.com/diagnose](https://rouxdutoit.com/diagnose)** — the website does steps 10–18 for you in the browser using these same anonymisation rules.

If you'd rather run the anonymisation entirely offline on your own computer (skipping rouxdutoit.com), continue with Part 2.

### Part 2 — Run the anonymiser script locally (only if you want full offline mode)

#### 10. Open Terminal (~30 seconds)

- macOS: ⌘+Space, type `Terminal`, Enter.
- Windows: search for `PowerShell` or `Terminal`.
- Linux: open your usual terminal app.

#### 11. Install bun (~1 minute)

Paste and press Enter:

```
curl -fsSL https://bun.sh/install | bash
```

#### 12. Close Terminal and open a fresh one (~10 seconds)

Quit the Terminal app entirely, then reopen it. (This makes `bun` available on your shell's path.)

#### 13. Clone this repo (~30 seconds)

```
git clone https://github.com/rouxdutoit/anonymiser.git ~/anonymiser
```

#### 14. Install dependencies (~30 seconds)

```
cd ~/anonymiser
```

```
bun install
```

#### 15. Move your CSV into the folder (~30 seconds)

```
cp ~/Desktop/bank.csv ~/anonymiser/bank.csv
```

If you have a credit-card CSV too:

```
cp ~/Desktop/cc.csv ~/anonymiser/cc.csv
```

#### 16. Run the anonymiser (~1 minute)

Pick **one** of these. Customise the `--currency` and `--hint` for your situation.

**Bank only:**

```
bun anonymise.ts bank.csv --currency ZAR --hint "B2B widgets, ~5M ZAR rev, 12 staff" -o sanitised.json
```

**Bank and credit card:**

```
bun anonymise.ts bank.csv --cc cc.csv --currency ZAR --hint "B2B widgets, ~5M ZAR rev, 12 staff" -o sanitised.json
```

The script prints a transparency summary showing exactly what was stripped.

### Part 3 — Verify and send

#### 17. Open `sanitised.json` and check it (~2 minutes)

Open `~/anonymiser/sanitised.json` in any text editor. The file should contain only:
- ✓ Round numbers (e.g. `4200`, `130000`, `89`) — no decimals
- ✓ Year + month dates (no day-level)
- ✓ Concentration ratios (`top5RevenueConcentrationPct: 78`)
- ✓ Category labels (`software_saas`, `payroll`)
- ✓ A random `analysisId` UUID (session ID, not derived from your data)

You should **not** see:
- ❌ Your name, customers' names, suppliers' names
- ❌ IBANs, account numbers, BICs, or 10+ digit numeric sequences
- ❌ Any decimal-formatted amount (`4237.56`)
- ❌ Any specific date (only year+month)
- ❌ Any transaction memo text

If you see anything from the "should not see" list, **stop, don't send, message Roux first**.

#### 18. Send `sanitised.json` to Roux

Email, Signal, Telegram — whatever's convenient. There's nothing identifying in it.

---

## What happens on Roux's side after you send

1. Your sanitised JSON goes through the same diagnostic pipeline used by paying customers on rouxdutoit.com — Cloudflare Workers AI running Kimi K2.6 in EU infrastructure.
2. The model produces structured findings: top three operational levers, benchmark position, open questions, suggested first engagement.
3. An 8-page PDF gets rendered in your styled template and sent back.
4. You schedule a 20-minute call with Roux to walk through the findings.

---

## FAQ

**"My bank's CSV has different column names."**
The parser auto-detects a wide set of common header names (case-insensitive, parens like `Amount (ZAR)` are normalised):

- **Date:** `date`, `datum`, `buchungsdatum`, `transaction date`, `trans date`, `posted date`, `value date`, `wertstellung`
- **Description:** `description`, `memo`, `verwendungszweck`, `details`, `reference`, `narration`, `particulars`, `narrative`
- **Amount (single signed column):** `amount`, `betrag`, `amount eur/zar/usd`, `value`, `transaction amount`
- **Or split debit/credit columns:** `debit`/`credit`, `soll`/`haben`, `money in`/`money out`, `withdrawal`/`deposit` — combined automatically
- **Type (optional):** `type`, `art`, `transaction type`, `dr/cr`

Order doesn't matter. Extra columns (Balance, Reference Number, etc.) are ignored. If your CSV uses something not in the list, rename the header in any text editor — or open an issue and we'll add it.

**"My amounts are like '1 234,56' (German style) or have a currency symbol."**
Handled automatically: both `1234.56` and `1.234,56` work. Currency symbols (€, R, $) are stripped before parsing.

**"My computer doesn't meet the 16 GB RAM requirement (only relevant for the LM Studio fallback)."**
Use the website instead with your bank's CSV export — it has no special hardware requirements. If your bank doesn't export CSV either, message Roux directly.

**"Can I look at what the script does before running?"**
Yes — that's the whole point of this repo being public. `anonymise.ts` is ~300 lines. The actual stripping logic is in `parsers/src/strip.ts`. About 30 minutes to read carefully if you know any programming language.

**"What if I want to delete everything afterwards?"**
After you've received your diagnostic, you can delete:
- The `~/anonymiser` folder
- The downloaded model in LM Studio (Discover → My Models → delete the Qwen one)
- LM Studio itself

Nothing about you persists anywhere — not on Roux's side either (the diagnostic worker is stateless, no logs, no database).
