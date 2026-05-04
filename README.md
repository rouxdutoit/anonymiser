# Anonymising your bank data — a step-by-step guide

This guide walks you through anonymising your bank and credit card data on **your own computer**, before you send anything to me. **There are 18 small steps.** Each one takes between 10 seconds and 5 minutes. The total first time is about 25 minutes (most of which is a coffee-break model download). Subsequent runs take ~5 minutes.

**You don't need to be a technical person.** You'll be doing two things you might not have done before:
1. Installing a desktop app called **LM Studio** (just like installing any other app — drag-and-drop on macOS, normal installer on Windows).
2. Pasting a few pre-written commands into a built-in Mac/Windows tool called **Terminal**.

**You will not be writing any code.** You'll only ever copy and paste from this guide. If anything goes wrong, message me with the error message and we'll sort it out — your data didn't go anywhere.

---

## Why this exists and what you're protecting

Your bank statement reveals a lot: your customers, suppliers, payroll size, exact balance, recurring spend. To produce a useful diagnostic, I need *patterns* (concentration ratios, recurring spend categories, working-capital signals) — but I do **not** need names, exact amounts, or any specific transaction.

This guide makes sure of that. By the end:

- The raw PDF and CSV stay on your computer.
- The anonymisation rules run on your computer (the script is short, public, and auditable: [github.com/rouxdutoit/anonymiser](https://github.com/rouxdutoit/anonymiser)).
- The only thing you send me is a small JSON file with rounded magnitudes, ratios, and category labels — readable plain text, no surprises.

---

## Before you start

Make sure your computer meets these:

- **RAM:** roughly 16 GB or more. Most Macs from 2020+ and most modern Windows/Linux machines comfortably do.
- **Free disk space:** about 6 GB (for the language model you'll download once, plus the script).
- **Operating system:** macOS, Windows, or Linux. Apple Silicon Macs (M1/M2/M3/M4) are especially fast at this.

If your computer is older or has less RAM, message me first — there's an easier off-ramp where I run the anonymiser on my side after a different secure handoff. Don't push through with a struggling computer.

---

## Progress checklist

Use this to keep track of where you are. Each box matches a numbered step further down.

> **Tip — make these clickable for yourself.** If you want to tick the boxes as you go, click the **Fork** button at the top right of this GitHub page first (it makes a personal copy of the repo on your account). Then on your fork, the checkboxes below become interactive. Otherwise the boxes are a visual reference only — feel free to print this page and tick with a pen.

**Part 1 — Convert your bank PDF to a CSV**
- [ ] **1.** Download LM Studio
- [ ] **2.** Open LM Studio for the first time
- [ ] **3.** Search for the model you'll use
- [ ] **4.** Download the model (coffee break)
- [ ] **5.** Open the Chat tab and load the model
- [ ] **6.** Attach your bank statement PDF
- [ ] **7.** Paste the extraction prompt
- [ ] **8.** Wait for the model and spot-check the result
- [ ] **9.** Save the CSV to your Desktop *(repeat for credit card if applicable)*

**Part 2 — Run the anonymiser script**
- [ ] **10.** Open Terminal
- [ ] **11.** Install bun
- [ ] **12.** Close Terminal and open a fresh one
- [ ] **13.** Download the anonymiser script
- [ ] **14.** Install the script's dependencies
- [ ] **15.** Move your CSV(s) into the anonymiser folder
- [ ] **16.** Run the anonymiser

**Part 3 — Verify and send**
- [ ] **17.** Open `sanitised.json` and check it by eye
- [ ] **18.** Send `sanitised.json` to Roux

---

## Part 1 — Convert your bank PDF to a CSV (steps 1–9)

A CSV is just a plain-text spreadsheet with a row per transaction (date, what it was, how much). It's the format the next part of the script understands. We use a small AI model running on your computer to read your bank PDF and write the CSV.

### Step 1. Download LM Studio (~3 minutes)

Go to **[lmstudio.ai](https://lmstudio.ai)** and click the big download button. It detects your operating system automatically.

Once downloaded, open the installer and install LM Studio just like any other app. On macOS that's drag-and-drop into Applications. On Windows that's the usual installer.

> **Don't worry if it asks for permissions.** That's macOS/Windows asking whether you trust the app. LM Studio is a legitimate, widely-used app — go ahead.

### Step 2. Open LM Studio for the first time (~1 minute)

Launch the app from your Applications folder (macOS) or Start menu (Windows). The first launch shows a welcome screen — click through the welcome and skip any tutorial. You'll know you're done when you see the main interface with icons down the left side (a magnifying glass, a chat bubble, a folder).

### Step 3. Search for the model you'll use (~2 minutes)

In LM Studio, click the **magnifying-glass icon** on the left side (this is the "Discover" tab — it's the model browser).

In the search box at the top, type exactly:

```
Qwen2.5-VL-7B-Instruct
```

Several results will appear. Pick the one labelled **`Q4_K_M`** (or anything similar with `Q4` in it).

> **What does Q4_K_M mean?** A smaller, faster version of the model that runs well on regular computers. You don't need to understand the rest of the name. Anything with `Q4` is fine.

### Step 4. Download the model (~5–10 minutes — go make coffee)

Click the **Download** button next to the version you picked. The download is about 5 GB. Depending on your internet, this takes 5–10 minutes.

> **Don't wait staring at it.** Walk away, get a coffee. It runs in the background. You'll know it's done when the button changes from "Downloading..." to a green checkmark or "Use".

### Step 5. Open the Chat tab and load the model (~1 minute)

Click the **chat-bubble icon** on the left side (the "Chat" tab).

At the top of the chat pane there's a dropdown that says **"Select a model to load"**. Click it and pick the Qwen model you just downloaded.

You'll see a small "Loading..." indicator for about 10 seconds while the model is loaded into your computer's RAM. When it's ready, the dropdown turns green or shows the model name without "Loading".

> **What just happened?** The model lives on your hard drive (5 GB), but to actually use it, your computer copies it into faster memory (RAM). That copy takes a few seconds. From now on it's ready to read your PDFs.

### Step 6. Attach your bank statement PDF (~30 seconds)

In the chat input box at the bottom, find the **paperclip icon** (the "attach" button). Click it and select your bank statement PDF from wherever you saved it.

You'll see a thumbnail of the PDF appear above the input box, confirming it's attached.

### Step 7. Paste this exact prompt (~1 minute)

Click into the chat input box. Copy the entire block below — including the line breaks — and paste it.

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

Press the send button (or Enter).

> **Don't worry about the technical phrasing of the prompt.** It's there to tell the model exactly what shape to give the answer. You don't need to understand it — just copy and paste.

### Step 8. Wait for the model and spot-check the result (~1–2 minutes)

The model now reads your PDF and writes out the transactions one row at a time. This takes 30 seconds to 2 minutes for a 90-day statement.

When it finishes, you'll see something like this in the chat:

```
date,description,amount
2024-01-15,Customer A payment,4500.00
2024-01-16,Adobe Creative Cloud,-89.00
...
```

**Spot-check 3–4 random rows against your PDF:**
- Does the date match a real transaction in the PDF?
- Is the amount roughly right? (you don't need to verify every cent)
- Is the sign correct? (negative = money out, positive = money in)

> **Don't worry if a row or two looks slightly off.** Local AI is good but not perfect. If something is clearly wrong, type "Please redo rows where the amount sign looks wrong" and the model will fix them. Big mistakes in the data here will be visible to me later — better to catch them now.

### Step 9. Save the CSV to your Desktop (~1 minute)

Highlight the entire CSV that the model wrote (from `date,description,amount` at the top to the last transaction line). **Cmd-C** on Mac (or Ctrl-C on Windows) to copy.

Open a plain-text editor:
- **macOS:** open the **TextEdit** app. Go to **Format → Make Plain Text** (this is important — without it the file gets formatting it shouldn't have).
- **Windows:** open **Notepad**.

Paste with **Cmd-V** (Mac) or **Ctrl-V** (Windows).

Save the file as **`bank.csv`** to your **Desktop**:
- **macOS:** File → Save → name it `bank.csv` → location: Desktop.
- **Windows:** File → Save As → "All Files" in the dropdown → name it `bank.csv` → location: Desktop.

> **Optional: do the same for your credit card statement.** Repeat steps 6–9 with your credit card PDF, save the result as `cc.csv` on your Desktop. The diagnostic gets sharper with credit card data, but works fine without.

---

## Part 2 — Run the anonymiser script (steps 10–16)

Now that your transactions are a clean CSV, you'll run a small script on your computer that strips out the identifying parts and produces the safe-to-send JSON. **This step never sends anything anywhere.**

### Step 10. Open Terminal (~30 seconds)

- **macOS:** press **Cmd + Space**, type **`Terminal`**, press Enter. A small window with a text prompt will appear.
- **Windows:** open the Start menu, type **`PowerShell`**, press Enter.
- **Linux:** open your usual terminal app.

> **Don't worry — Terminal is just a text-based window where you paste pre-written commands.** You won't type anything yourself. Think of it like a calculator app: you give it instructions, it runs them. The look (text on a black background) is intimidating but the experience is just paste-and-press-Enter.

### Step 11. Install bun (~1 minute)

`bun` is a small, free, open-source program that runs the anonymiser script. You install it once.

Copy this line and paste it into Terminal, then press Enter:

```
curl -fsSL https://bun.sh/install | bash
```

Wait for it to finish. You'll see lots of text scroll by — that's normal, it's downloading and installing. When it's done, you'll see a green or white message that says something like "bun was installed successfully".

> **What did this just do?** It downloaded a small program called bun and installed it on your computer. It's similar to downloading an app from the App Store, just done in Terminal because bun isn't on the App Store. The whole thing is about 50 MB.

### Step 12. Close Terminal and open a fresh one (~10 seconds)

**Quit the Terminal app entirely** (Cmd-Q on Mac, or close the window on Windows). Then open it again from the start.

> **Why this odd step?** The first install added `bun` to your computer's "list of available programs". A fresh Terminal window picks up the updated list. If you skip this step, the next command will fail with `bun: command not found`.

### Step 13. Download the anonymiser script (~30 seconds)

Paste this command into the new Terminal window and press Enter:

```
git clone https://github.com/rouxdutoit/anonymiser.git ~/anonymiser
```

> **What does that mean?**
> - `git clone` = download a folder of code from GitHub.
> - The URL is the public anonymiser repository — anyone can see it, anyone can verify what's in it.
> - `~/anonymiser` = save it as a folder called `anonymiser` inside your home folder. (`~` is shorthand for your home folder, where Documents, Desktop, etc. live.)
>
> After this command, if you open Finder (Mac) or File Explorer (Windows), you'll see a new folder called `anonymiser` in your home folder. That's where the script lives now. You can open it and look around if you want.

### Step 14. Install the script's dependencies (~30 seconds)

Paste these two commands one at a time. The first one moves you into the anonymiser folder; the second installs the small bits of code the script needs:

```
cd ~/anonymiser
```

```
bun install
```

You'll see a few lines like "Resolving 40 packages..." and then "Done". That's bun fetching helper code (just like an app might need supporting files when first installed).

> **Don't worry — none of this touches your bank data yet.** This is purely setup. Your CSV is still safely on your Desktop, untouched.

### Step 15. Move your CSV(s) into the anonymiser folder (~30 seconds)

The script needs your CSV to live alongside it. Run this command (it copies the file from Desktop to the anonymiser folder):

```
cp ~/Desktop/bank.csv ~/anonymiser/bank.csv
```

If you also made a credit card CSV, also run:

```
cp ~/Desktop/cc.csv ~/anonymiser/cc.csv
```

If you didn't make a credit card CSV, just skip the second command.

### Step 16. Run the anonymiser (~1 minute)

This is the main event. Pick **one** of the two commands below, depending on whether you have a credit card CSV. **Read the explanation under it before running** — you'll want to customise the `--currency` and `--hint` parts.

**Bank statement only:**

```
bun anonymise.ts bank.csv --currency ZAR --hint "B2B widgets, ~5M ZAR rev, 12 staff" -o sanitised.json
```

**Bank statement and credit card together:**

```
bun anonymise.ts bank.csv --cc cc.csv --currency ZAR --hint "B2B widgets, ~5M ZAR rev, 12 staff" -o sanitised.json
```

**Customise these two parts** to match your situation:
- `--currency ZAR` → change `ZAR` to whatever currency your statement is in (`EUR`, `USD`, `GBP`, etc.).
- `--hint "..."` → put a one-sentence description of your business inside the quotes. Industry, rough revenue, headcount. Examples:
  - `--hint "B2C fashion retailer, ~12M ZAR revenue, 25 staff"`
  - `--hint "Software consultancy, ~3M EUR revenue, 8 staff"`
  - `--hint "Manufacturing, ~50M ZAR revenue, 80 staff"`

The other parts (`bun anonymise.ts`, `bank.csv`, `-o sanitised.json`) you don't need to change.

After you press Enter, the script reads your CSV, anonymises it, and writes a new file called `sanitised.json`. The whole thing takes about 5 seconds. You'll see a **transparency summary** in the terminal showing what was stripped and what remained:

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

> **If you see an error instead:** copy the error message and send it to me. Most likely a tiny CSV format quirk (e.g. an unusual character in a description). Your data didn't go anywhere — the script either succeeds or refuses to write the output, never partway.

---

## Part 3 — Verify and send (steps 17–18)

### Step 17. Open `sanitised.json` and check it by eye (~2 minutes)

Open Finder (Mac) or File Explorer (Windows), navigate to your home folder, then into **`anonymiser`**. You'll see a file called **`sanitised.json`**. Open it in any text editor.

It will look something like this:

```json
{
  "schemaVersion": "0.2",
  "analysisId": "8a3f1b22-e4d2-4fa1-9b80-c0a9...",
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
  "recurringSpend": { "detectedSubscriptionCount": 14, ... }
}
```

Things you should **not** see anywhere in this file:

- ❌ Your name, your customers' names, your suppliers' names
- ❌ Your IBAN, account number, BIC, or any 10-plus-digit numeric sequence
- ❌ Any transaction memo text (like "Invoice 2024-0042 from Müller GmbH")
- ❌ Any exact amount with a decimal point (everything should be round numbers like `4200`, `130000`, `89`)
- ❌ Any specific day-level date (only `year` + `month` should appear)

The one alphanumeric ID you *will* see — `analysisId` — is a random session ID generated on your computer when you ran the script. It identifies this analysis run, not you. Nothing in it is derived from your data.

> **If you see anything from the "should not see" list, stop, don't send, message me first.** That's a bug — your data should never make it through. We'll fix it.

### Step 18. Send `sanitised.json` to me (~1 minute)

Send the `sanitised.json` file via whatever channel you prefer — email attachment, Signal, Telegram, whatever. Plain text. There's nothing identifying in it.

If you used `--hint` in step 16, paste the hint text into the message body too — it gives me extra context to frame the diagnostic correctly.

**You're done.** I'll process the JSON within 24 hours and send back an 8-page diagnostic PDF.

---

## What happens next on my side

1. I run your sanitised JSON through the same diagnostic pipeline used by paying customers on rouxdutoit.com.
2. The model produces structured findings (top 3 operational levers, benchmark position, open questions, suggested first engagement).
3. I render an 8-page PDF using the styled template — same format as paying customers — and send it back.
4. We schedule a 20-minute call, review the findings together, decide whether there's a leverage point worth a 30-day engagement.

Total turnaround: usually within 24 hours of receiving your sanitised JSON.

---

## If something goes wrong

**At any step, if a command errors out or something doesn't match what this guide says:**

1. **Don't panic.** Your data didn't go anywhere. The script either succeeds end-to-end or refuses to write any output.
2. **Copy the exact error message** (or take a screenshot of the Terminal window).
3. **Send it to me with which step you were on**. We'll figure it out.

The most common stumbles and their fixes:

| What you see | What to do |
|---|---|
| `bun: command not found` | You skipped step 12 (close and reopen Terminal). Do that now and rerun the failed step. |
| `No such file or directory: bank.csv` | You're not in the right folder. Run `cd ~/anonymiser` first, then try again. |
| `Could not auto-detect column(s)` from the script | Your CSV's column names are unusual. Send me the CSV's first row (the header) and I'll tell you what to rename. |
| LM Studio can't load the model / out of memory | Your computer is short on RAM. Quit other apps (especially browsers with many tabs), try again. If still failing, message me — there's a smaller model option, or I can run anonymisation on my side. |
| You see something in `sanitised.json` that *should* have been stripped | Stop, don't send, message me. That's a bug to fix. |

---

## Frequently asked questions

**"How private is this really?"**
The model in LM Studio runs entirely on your computer's RAM/GPU — no internet calls during the actual reading of your PDF. The anonymiser script also runs locally. Nothing leaves your computer until *you* send the sanitised JSON. You can read every byte of that JSON before sending. The anonymisation rules are open-source at [github.com/rouxdutoit/anonymiser](https://github.com/rouxdutoit/anonymiser) — anyone you trust to read code can verify them.

**"My computer doesn't have 16 GB of RAM. What now?"**
Two options. Option 1: message me — for trusted off-funnel customers, I can run the anonymiser on my side using a different secure handoff. Option 2: a smaller model exists (Qwen2.5-VL-3B, ~2 GB) but its accuracy on bank statements is noticeably lower; you'd have to spot-check more carefully. I'd recommend Option 1.

**"My amounts are like '1 234,56' (German style) or have a currency symbol — will the script work?"**
Yes. The script handles both `1234.56` and `1.234,56`. If LM Studio's CSV has currency symbols (€, R, $) in the amount column, the script removes them automatically. The prompt in step 7 also asks the model to skip them.

**"My bank already exports a CSV. Can I skip the LM Studio part?"**
If your bank's exported CSV happens to have columns called `date`, `description`, `amount` (or close — the script auto-detects common variations like `Transaction Date`, `Reference`, `Particulars`, `Debit`+`Credit` pairs), then yes — save it as `bank.csv` on your Desktop and skip straight to step 15. If the script complains about the column names, it'll show you what it found and what it accepts; rename the headers in any text editor and try again.

**"Can I look at what the script does before running it?"**
Yes — once you've done step 13, the script lives at `~/anonymiser/anonymise.ts`. It's a single ~300-line TypeScript file you can open in any text editor. The actual stripping logic lives in `~/anonymiser/parsers/src/strip.ts`. About 30 minutes to read carefully if you know any programming language.

**"What if I want to delete everything afterwards?"**
After you've sent me the JSON and received your diagnostic, you can delete:
- The `~/anonymiser` folder (the script and the CSVs)
- The downloaded model in LM Studio (Discover → My Models → delete the Qwen one)
- LM Studio itself (uninstall like any other app)

Nothing about you persists anywhere.
