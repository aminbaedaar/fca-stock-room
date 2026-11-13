# First Choice Africa Ltd (FCA Stock Room)

Stock management for **First Choice Africa Limited**, Kigali. One codebase runs as:

- a **website** (computers, tablets, phones, can be installed to the home screen), and
- a **desktop app** for macOS (Apple Silicon + Intel) and Windows 10/11, with auto-update.

All devices share one online database (Supabase), so a change made on one device shows on every other device within a second.

- **Setting it up (non-programmers):** [docs/SETUP.md](docs/SETUP.md)
- **How to use it (Admins, Bosses, Managers, Staff):** [docs/USER-GUIDE.md](docs/USER-GUIDE.md)

## Try it now (demo mode)

Without any accounts, the app runs in **demo mode** with the 76 items and count history from `data/stock-report-2026-10-26.xlsx`. Data stays in that browser only.

```bash
npm install
npm run dev
```

Open http://localhost:5173 and pick a demo role.

## How it is built

| Part | Technology | Where |
|---|---|---|
| Screens | React + TypeScript + Vite, Poppins, light/dark themes | `apps/web` |
| Calculations (shared everywhere) | TypeScript, unit tested | `packages/core` |
| Database, login, live updates | Supabase (PostgreSQL, row-level security, realtime) | `supabase/migrations` |
| AI assistant | Claude API, called only from a server function | `supabase/functions/ai-assistant` |
| Monday summary (07:37 Kigali) | Server function + `pg_cron`, email via Resend, web push | `supabase/functions/monday-summary`, `supabase/cron.sql` |
| Desktop apps | Tauri 2 (small installers, auto-update) | `apps/desktop` |
| Installers | GitHub Actions builds `.dmg` and `.exe`/`.msi` on each version tag | `.github/workflows/desktop.yml` |
| Website hosting | Vercel (free) | `vercel.json` |
| Daily backup | GitHub Actions `pg_dump`, kept 30 days | `.github/workflows/backup.yml` |
| Job calculator (SQM & wastage) | Carried over from the standalone SQM calculator, same results (tested) | `packages/core/src/sqm.ts`, `apps/web/src/pages/Calculator.tsx`, `supabase/migrations/0004_sqm.sql` |
| Excel import / export | SheetJS | `apps/web/src/lib/excel.ts`, `packages/core/src/importer.ts` |

### Folder map

```
apps/web/            the app (all screens)
  src/data/          store (offline queue, live updates), engine (same rules as the DB), backends
  src/pages/         Dashboard, Stock, Movements, Requests, Jobs, Team, Import, Print sheet, Login
  src/i18n/en.json   all interface text (copy to fr.json / rw.json to translate)
apps/desktop/        Tauri desktop shell (icons, updater)
packages/core/       calculations, roles, Excel importer, Monday report + tests
supabase/            migrations (tables, functions, row-level security), server functions, cron, seed
scripts/             make-seed (Excel → seed data), sync-core (copy core to server functions)
data/                your original Excel and logo
docs/                setup guide and user guide
```

## Roles

| Action | Admin | Boss | Manager | Staff | Viewer |
|---|---|---|---|---|---|
| Use the job calculator (SQM & wastage, PDF report) | ✓ | ✓ | ✓ | ✓ | ✓ |
| See stock, movements, dashboard, AI assistant | ✓ | ✓ | ✓ | ✓ | – |
| Request material for a job | ✓ | ✓ | ✓ | ✓ | – |
| Stock in / stock out | ✓ | ✓ | ✓ | ✓ | – |
| Adjust stock, add / edit / remove items | ✓ | ✓ | ✓ | – | – |
| Approve or reject requests, weekly stock take | ✓ | ✓ | ✓ | – | – |
| Write the Monday summary now | ✓ | ✓ | ✓ | – | – |
| Reverse a movement (a reason is required) | ✓ | ✓ | ✓ | – | – |
| See the team, set roles, import, full backup | ✓ | – | – | – | – |

*Viewers* see just the Job calculator tab; the database does not let them read stock, movements, requests, reports or the team list (`supabase/migrations/0006_viewer_calculator_only.sql`). Only the Admin can see the team list; everyone else can read just their own record (`0007_team_and_reverse.sql`).

The first person to sign up becomes Admin; everyone after starts as Staff. Rules are enforced **in the database** (`fca_can` in `supabase/migrations/0002_functions.sql`): tables are read-only to the API and every change goes through a function that checks the role first. `packages/core/src/roles.ts` holds the same table for the screens, and a test checks the two match.

## Calculations

All in `packages/core/src/calc.ts`, used by the dashboard, stock list, Monday report and AI assistant:

- Take the last **9** count-history points, sorted by date.
- List the decreases between consecutive counts. A decrease is a **count correction** (ignored) if it is more than half of the previous count **and** at least 4× the median of the item's other decreases.
- **Weekly use** = remaining decreases ÷ weeks between the first and last point.
- **Weeks of cover** = stock ÷ weekly use.
- **Suggested order** = round up (max(minimum, 6 × weekly use) − stock); 0 or less = no order.
- **Status:** Out if stock = 0; Low if stock ≤ minimum or cover < 3 weeks; otherwise OK.

## Offline and sync

Every change gets an id made on the device. Changes are shown at once (using `apps/web/src/data/engine.ts`, the same rules as the database), kept in a queue on the device while offline, and sent when the connection returns. The database ignores an id it has already saved, so nothing is lost or duplicated. An "Offline" banner shows while disconnected. Adding new items, changing roles and importing need a connection.

## Tests

```bash
npm test
```

- `calc.test.ts` – weekly use, corrections, cover, order, status
- `roles.test.ts` – permission table, and that the database uses the same table
- `importer.test.ts` – reads your real October 2026 Excel: 76 items, dates, units, ink by machine
- `report.test.ts` – Monday summary content and length
- `database.test.ts` – runs the real migrations in an in-memory PostgreSQL: sign-up roles, row-level security, stock in/out, offline retries, void, requests, **stock-take flow**, item edits, import

## Your Excel import: what to know

- In your sheets, the first number column (PCS / IN LITTER) is read as **opening stock**, and each count is read as belonging to the date above it. The Import screen lets you switch to the other reading if needed.
- Three items have a newer number after the 26 Oct column (Glossy 1.27 = 194, Frosty 1.52 = 57, Pull-up wide base = 72); that is used as current stock.
- *A2 Frame* is counted in boxes plus loose pieces ("6 BOXES+6PCS"): stock is 6 boxes and the pieces are kept in the note.
- *Ground pop-up metal stand* switched from boxes to pieces in August; only the pieces counts are used.
- Minimum levels were not in the Excel, so they start at 0. Set them in **Stock → ✎ Edit**.
- Ink items are named by machine (e.g. `SK-7 INK`, size `CYAN`), which is how the dashboard groups them.

To regenerate the seed data after changing the Excel: `npm run seed`.
