# The Family Ledger

The household's Statement of Financial Condition workbook as a small web app, served at `/ledger/` (and `ledger.graceandgrithomeco.com` once that domain is added in Vercel).

- One part per sheet: **Pay Schedule** (Notes), **Monthly Expenses & Net Worth** (Worksheet), the **rent** sheet, and **Cut Expenses**.
- **Import** reads the workbook as laid out; **Export** writes the same four sheets plus a hidden `_ledger` sheet so it imports back exactly.
- Saves in the browser (`localStorage`, key `ledger.v1`), optionally to a folder (Edge/Chrome), and to JSON backups. Each part prints on its own.

No financial data lives in this repository. The app starts empty; the numbers stay on the device that imports them.
