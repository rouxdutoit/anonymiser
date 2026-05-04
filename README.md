# Anonymising your bank data — a step-by-step guide

This guide walks you through anonymising your bank and credit card data on **your own computer**, before you send anything to me. About 15 minutes the first time you do it, ~3 minutes for any future runs.

You'll use:
- **LM Studio** — a free desktop app that runs an open-source language model locally on your computer. Used to extract the transactions from your bank PDF.
- **Terminal** — built into your operating system. Used to run the anonymisation script.

**Nothing about your finances reaches a third party.** The model in LM Studio runs entirely on your computer's RAM. The anonymisation script also runs locally. The only thing that leaves your computer is the final sanitised JSON you send to me — and you can read every byte of it before sending.

The script you'll run is **public and auditable**: [github.com/rouxdutoit/anonymiser](https://github.com/rouxdutoit/anonymiser). Anyone can read the rules and verify they do what they claim.

---

## What this guide does and why

You'll do three things:

| # | What | Why |
|---|---|---|
| 1 | Use LM Studio to convert your bank PDF into a CSV of transactions | The bank PDF format varies — once it's a CSV (date, description, amount), the anonymiser script can process it deterministically. |
| 2 | Run the anonymiser script on the CSV | It strips names, account numbers, vendor names, and exact amounts. You keep the original CSV; only the *anonymised* output gets sent. |
| 3 | Send the anonymised JSON to Roux | Reviewable plain text. You can read every byte before sending. Nothing identifying in it. |

**System requirements:** roughly **16 GB of RAM** and **5–10 GB of free disk** for the model weights. Apple Silicon Macs (M1/M2/M3/M4) and recent Windows/Linux machines with a decent GPU handle this comfortably. Older Intel Macs may struggle.

---

## Step 1 — Convert your bank PDF to a CSV using LM Studio

### Install LM Studio (one-time, ~3 minutes)

1. Go to [lmstudio.ai](https://lmstudio.ai) and download the installer for your OS.
2. Install like any normal app (drag to Applications on macOS, run the installer on Windows/Linux).
3. Open LM Studio. First launch shows a welcome screen — close any onboarding.

### Download a vision model (one-time, ~5–10 minutes depending on your internet)

LM Studio talks to a small model that can read PDFs. You only download this once.

1. In LM Studio, click **Discover** in the left sidebar (the magnifying-glass icon).
2. In the search box, type:

   ```
   Qwen2.5-VL-7B-Instruct
   ```

3. Pick the result tagged **`Q4_K_M`** or similar (around 5 GB — a quantised version that runs well on consumer hardware).
4. Click **Download**. Wait for it to finish.

### Extract your bank transactions

1. Switch to the **Chat** tab (speech-bubble icon in the left sidebar).
2. At the top of the chat panel, click **Select a model to load** and pick the Qwen model you just downloaded. Wait ~10 seconds for it to load into RAM.
3. In the chat input at the bottom, click the **paperclip / attach** icon and select your bank statement PDF.
4. Paste this prompt exactly:

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

5. Press send. The model will read the PDF and produce a CSV. This takes 30–90 seconds for a 90-day statement — local inference is slower than cloud, but it's **yours**.
6. **Sanity-check by spot-checking a few rows against the PDF**: dates align, amounts match, signs are right (negative = money out). If something looks wrong, ask the model to "redo the rows where dates are wrong" or similar.
7. Copy the CSV text. Paste into a plain-text editor (TextEdit on macOS — switch to plain text via Format → Make Plain Text — or VS Code, or Notepad on Windows). Save as `bank.csv` somewhere you'll remember (e.g. `~/Desktop/bank.csv`).

### Optional: do the same for your credit card statement

If you have a credit card you'd like included, repeat the same steps for the credit-card PDF and save the result as `cc.csv`. The diagnostic gets sharper with more data; it works fine with bank only.

---

## Step 2 — Run the anonymiser script on your computer

This step **never sends anything anywhere**. The script reads the CSV, applies the anonymisation rules, and writes the result to a new file. You then read that file to confirm it's clean before sending.

### One-time setup

Open Terminal (macOS: ⌘+Space, type "Terminal", Enter — Windows: search for "PowerShell" or "Terminal"). Then run these commands one block at a time — paste each block, press Enter, wait for it to finish.

**1) Install `bun`** — a small, fast JavaScript runtime needed to run the script (like `node` but simpler):

```
curl -fsSL https://bun.sh/install | bash
```

When that finishes, close the Terminal window and open a fresh one. (This is so `bun` becomes available on your shell's path.)

**2) Clone the public anonymiser repo into your home folder:**

```
git clone https://github.com/rouxdutoit/anonymiser.git ~/anonymiser
```

**3) Move into the new folder and install its dependencies:**

```
cd ~/anonymiser
bun install
```

None of this touches your bank data — it's just installing the script and its tools. You only do this once. Future runs are just the next command.

### Run it

Move your CSV file into the anonymiser folder (assumes you saved it to your Desktop):

```
cp ~/Desktop/bank.csv ~/anonymiser/bank.csv
```

If you also made a credit-card CSV, move that one too (skip this command if you don't have one):

```
cp ~/Desktop/cc.csv ~/anonymiser/cc.csv
```

Change to the anonymiser folder:

```
cd ~/anonymiser
```

Now run the anonymiser. Pick **one** of these two — bank-only, or bank-plus-credit-card.

**Bank statement only:**

```
bun anonymise.ts bank.csv --currency ZAR --hint "B2B widgets, ~5M ZAR rev, 12 staff" -o sanitised.json
```

**Bank statement and credit card together:**

```
bun anonymise.ts bank.csv --cc cc.csv --currency ZAR --hint "B2B widgets, ~5M ZAR rev, 12 staff" -o sanitised.json
```

What each flag does:
- `bank.csv` → the CSV you made in Step 1.
- `--cc cc.csv` → optional credit-card CSV (drop this flag if you don't have one).
- `--currency ZAR` → just metadata. Use the actual currency of your statement (`ZAR`, `EUR`, `USD`, etc.).
- `--hint "..."` → a short free-text description of your business: industry, rough size, headcount. Optional but improves the diagnostic. Not included in the sanitised JSON; it goes in your message to Roux.
- `-o sanitised.json` → output filename. The script writes the anonymised data here.

The script will print a **transparency summary** in the terminal — what it stripped, what survived. Read it. You should see something like:

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
- ❌ Your IBAN, account number, BIC, or any 10-plus-digit numeric sequence
- ❌ Any transaction memo text (e.g. "Invoice 2024-0042 from Müller GmbH")
- ❌ Any exact amount with a decimal point (everything should be round numbers like `4200`, `130000`, `89`)
- ❌ Any specific day-level date (only `year` + `month` should appear)

The one alphanumeric ID you *will* see — `analysisId` — is a random UUID generated on your computer at the moment the script ran. It identifies the analysis session, not you. Nothing in it is derived from your data.

If you see anything else from the "should not see" list, **stop, don't send, message Roux first** — something didn't strip correctly and that's a bug worth fixing.

---

## Step 3 — Send the sanitised JSON to Roux

Send `~/anonymiser/sanitised.json` via whatever channel you prefer. Plain text in an email is fine — there's nothing identifying in it.

If you used `--hint`, paste your hint text in the message body alongside the file: it gives Roux additional context that helps the diagnostic frame correctly.

---

## What happens next on Roux's side

1. Roux runs your sanitised JSON through the same diagnostic pipeline used by paying customers on rouxdutoit.com.
2. The model produces structured findings (top 3 operational levers, benchmark position, open questions, suggested first engagement).
3. Roux renders an 8-page PDF using the styled template — same format as paying customers — and sends it back.
4. You schedule a 20-minute call, review the findings together, decide whether there's a leverage point worth a 30-day engagement.

Total turnaround: usually within 24 hours of receiving your sanitised JSON.

---

## Frequently asked questions

**"Am I sure my data is safe at every step?"**
Yes. LM Studio runs the model entirely on your computer's RAM/GPU — no telemetry, no internet calls during inference. The anonymiser script runs locally too. Nothing leaves your computer until you actively send the sanitised JSON. The public anonymiser repo at [github.com/rouxdutoit/anonymiser](https://github.com/rouxdutoit/anonymiser) lets you (or anyone you trust to read TypeScript) verify exactly what the script strips.

**"My computer doesn't meet the 16 GB RAM requirement — what now?"**
Two options. Option 1: ask Roux directly — for trusted off-funnel customers, he can anonymise on his side using the same script (you'd send the raw CSV via a secure channel, his server does the strip step on receipt and immediately discards the raw input). Option 2: smaller models exist (Qwen2.5-VL-3B, ~2 GB) but their accuracy on bank statements drops noticeably; you'd have to spot-check more carefully.

**"My amounts are like '1 234,56' (German style) or have a currency symbol — will the script work?"**
The script handles both `1234.56` and `1.234,56`. If the LLM-extracted CSV has currency symbols (€, R, $) in the amount column, the script strips them automatically. Step 1's prompt already asks the model to omit them.

**"What if the script throws an error?"**
Copy the error message and send it to Roux. Most likely a CSV format quirk that's easy to fix on this end. Your data didn't go anywhere.

**"Can I look at what the script does before running?"**
Yes — it's a single TypeScript file at `anonymise.ts` in the `~/anonymiser` folder. ~300 lines. The actual stripping logic lives in `parsers/src/strip.ts` (open-source, public). 30-minute read for a competent developer.

**"My bank already exports CSV. Can I skip Step 1 entirely?"**
If your bank's CSV happens to have columns named `date`, `description`, `amount` (or close enough — the script auto-detects common variations like `Transaction Date`, `Reference`, `Particulars`, `Debit`+`Credit` pairs), then yes — save the file as `bank.csv` and skip straight to Step 2. If the script complains about headers, it'll show you what it found and what it accepts; you can rename the headers in any text editor and re-run.
