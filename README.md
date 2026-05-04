# Anonymising your bank data — a step-by-step guide

This guide walks you through anonymising your bank and credit card data on **your own laptop**, before you send anything to me. Total time: ~10 minutes. Total tools: a web browser, a free Claude account, and one terminal command. No software install beyond `bun` (one-line setup).

The script you'll run is **public and auditable**: [github.com/rouxdutoit/anonymiser](https://github.com/rouxdutoit/anonymiser). Anyone can read the rules and verify they do what they claim.

---

## What this guide does and why

You'll do three things:

| # | What | Why |
|---|---|---|
| 1 | Get your transactions out of the bank PDF as a CSV | The bank PDF format isn't standard; once it's a CSV (date, description, amount), the anonymiser script can process it deterministically. |
| 2 | Run the anonymiser script on the CSV on your laptop | It strips names, account numbers, and exact amounts. You keep the original CSV; you only send the *anonymised* output. |
| 3 | Send the anonymised JSON to Roux | Reviewable plain text. You can read every byte before sending. Nothing about you, your customers, or your suppliers is identifiable in it. |

---

## Step 1 — Convert your bank PDF to a CSV

You have two paths. Pick whichever your bank supports.

### Path A — your bank's "Export to CSV" button (easiest)

Most modern online banking has this. Look in your statements view for **Download CSV**, **Export**, or **Excel/spreadsheet** options. If you find it, you're done with Step 1.

The file should have at least these columns: **date**, **description** (or "memo"), and **amount**. Save it somewhere you'll remember (e.g. `~/Desktop/bank.csv`).

If your bank exports something with different column names, you can rename them in any text editor — the script accepts `date / description / amount` (also `datum / verwendungszweck / betrag`).

### Path B — Use Claude to extract the transactions (if no CSV export)

If your bank only gives PDFs:

1. Go to [claude.ai](https://claude.ai) and sign in (free account works).
2. Click the **paperclip / attach** icon in the chat input. Upload your bank statement PDF.
3. Paste this prompt exactly:

   ```
   This is a bank statement. Extract every transaction as a CSV with exactly these columns:

   date,description,amount

   Rules:
   - One row per transaction. Header row included.
   - date: ISO format YYYY-MM-DD
   - description: the full memo / Verwendungszweck, single line, no extra commas (replace any internal comma with a semicolon)
   - amount: positive for money in (deposits, customer payments). Negative for money out (payments, fees, transfers out). Decimal with a period (e.g. 1234.56), no thousand separators.

   Return only the CSV. No commentary, no markdown fences, no backticks.
   ```

4. Claude will reply with a CSV block. **Select the entire CSV text and copy it.**
5. Open a plain-text editor (TextEdit on Mac with Format → Make Plain Text, or VS Code, or even Notes saved as `.txt`). Paste. Save as `bank.csv` somewhere you'll remember (e.g. `~/Desktop/bank.csv`).

**Why this is safe-ish:** Claude does see your raw bank statement in this step. That's a one-time exposure to Anthropic on your account, your decision. The next steps anonymise *before* anything reaches Roux. If you'd rather not send the PDF to Claude, use Path A instead, or transcribe the rows manually.

### Same again for your credit card statement (optional)

If you have a credit card you want included, repeat for `cc.csv`. Same column format. The diagnostic gets sharper with more data; it works fine without it.

---

## Step 2 — Run the anonymiser on your laptop

This step **never sends anything anywhere**. The script reads the CSV, applies the anonymisation rules, and writes the result to a new file. You then read that file to confirm it's clean before sending.

### One-time setup (90 seconds)

Open Terminal (macOS: ⌘+Space, type "Terminal", Enter). Paste:

```bash
# Install bun (a JavaScript runtime — required to run the script)
curl -fsSL https://bun.sh/install | bash

# Clone the anonymiser repo
git clone https://github.com/rouxdutoit/anonymiser.git ~/anonymiser
cd ~/anonymiser
bun install
```

What that does: installs `bun` (a small, fast tool to run the script — like `node` but simpler), pulls down the public anonymiser repo to `~/anonymiser`, and installs its dependencies. None of this touches your bank data.

You only do this once. Future runs are just the next command.

### Run it

Move your CSV(s) into the anonymiser folder for convenience, then run:

```bash
cp ~/Desktop/bank.csv ~/anonymiser/bank.csv
# Optional, only if you have a credit card CSV:
cp ~/Desktop/cc.csv ~/anonymiser/cc.csv

cd ~/anonymiser

# Bank statement only:
bun anonymise.ts bank.csv --currency ZAR --hint "B2B widgets, ~5M ZAR rev, 12 staff" -o sanitised.json

# Or with credit card too:
bun anonymise.ts bank.csv --cc cc.csv --currency ZAR --hint "B2B widgets, ~5M ZAR rev, 12 staff" -o sanitised.json
```

What each flag does:
- `bank.csv` → the CSV you just made.
- `--cc cc.csv` → optional credit-card CSV (drop this flag if you don't have one).
- `--currency ZAR` → just metadata, helps Roux frame the diagnostic correctly. Use the actual currency of your statement (`ZAR`, `EUR`, `USD`, etc.).
- `--hint "..."` → a short free-text description of your business: industry, rough size, headcount. Optional but improves the diagnostic. It is **not** included in the sanitised JSON; it goes in your message to Roux.
- `-o sanitised.json` → output filename. The script writes the anonymised data here.

The script will print a **transparency summary** in the terminal — what it stripped, what survived. Read it. You should see things like:

```
=== Transparency summary ===
Input:           247 bank tx + 89 credit-card tx
Output schema:   0.2
Total tx kept:   336

Stripped before output:
  - all account holder names
  - all IBANs / account numbers
  - all vendor / counterparty names
  - all exact amounts (rounded to 2 sig figs)
  - all specific dates (kept only month/year aggregations)
  - all transaction memos (only category labels remain)
```

### Verify by eye

Open `~/anonymiser/sanitised.json` in any text editor. You should see something like:

```json
{
  "schemaVersion": "0.2",
  "analysisId": "8a3f...e4d2",
  "source": { "type": "bank_statement", "bankCategory": "other", "periodDays": 90 },
  "companyShape": { "revenueBand": "5_to_25m", "growthSignal": "stable", ... },
  "cashFlow": {
    "monthlyInflows": [
      { "year": 2024, "month": 1, "amount": 420000 },
      ...
    ],
    "largestInflowConcentrationPct": 23,
    ...
  },
  "customers": { "distinctCustomerCount": 47, "top5RevenueConcentrationPct": 78, ... },
  "suppliers": { "distinctSupplierCount": 31, "top5SpendConcentrationPct": 62, ... },
  "recurringSpend": { "detectedSubscriptionCount": 14, ... },
  ...
}
```

Things you should **not** see anywhere in this file:
- ❌ Your name, your customers' names, your suppliers' names
- ❌ Your IBAN, account number, BIC, or any long number
- ❌ Any transaction memo text (e.g. "Invoice 2024-0042 from Müller GmbH")
- ❌ Any exact euro/rand/dollar amount (everything should be a round number like 4200, 130000, 89)
- ❌ Any specific date (only year + month buckets)

If you see any of those, **stop, don't send, message Roux first** — something didn't strip correctly and that's a bug worth fixing on this end.

---

## Step 3 — Send the sanitised JSON to Roux

Send `~/anonymiser/sanitised.json` via whatever channel you prefer. Plain text in an email is fine — there's nothing identifying in it.

If you used `--hint`, paste your hint text in the message body alongside the file: it gives Roux additional context that helps the diagnostic frame correctly.

---

## What happens next on Roux's side

1. Roux runs your sanitised JSON through the same diagnostic pipeline used by the public funnel at rouxdutoit.com.
2. The model produces structured findings (top 3 operational levers, benchmark position, open questions, suggested first engagement).
3. Roux renders an 8-page PDF using the styled template — same format as paying customers — and sends it back.
4. You schedule a 20-minute call, review the findings together, decide if there's a leverage point worth a 30-day engagement.

Total turnaround: usually within 24 hours of receiving your sanitised JSON.

---

## Frequently asked questions

**"Am I sure my data is safe at every step?"**
Steps 2 and 3 never leave your machine until you actively send the JSON. Step 1 (Path B) does upload the PDF to Claude — that's a one-time exposure to Anthropic on your account, your call. Path A skips that entirely. The public anonymiser repo at github.com/rouxdutoit/anonymiser lets you (or anyone you trust to read the code) verify exactly what gets stripped.

**"What if my bank's CSV has different columns?"**
Open the CSV in a text editor and rename the header row. The script accepts:
- date columns named `date`, `datum`
- description columns named `description`, `memo`, `verwendungszweck`
- amount columns named `amount`, `betrag`
- (optional) type columns named `type`, `art`
Other columns are ignored.

**"My amounts are like '1 234,56' (German style) or have a currency symbol — will it work?"**
The script handles both `1234.56` and `1.234,56`. Strip any currency symbols (€, R, $) from the amount column with find-and-replace before running, just in case.

**"What if the script throws an error?"**
Copy the error message and send it to Roux. Most likely a CSV format quirk that's easy to fix on this end. Your data didn't go anywhere.

**"Can I look at what the script does before running?"**
Yes — it's a single TypeScript file at `anonymise.ts` in the `~/anonymiser` folder. ~250 lines. The actual stripping logic lives in `parsers/src/strip.ts` (open-source, public). 30-minute read for a competent developer.
