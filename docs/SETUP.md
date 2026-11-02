# Setting up FCA Stock Room — step by step

This guide is for someone who is not a programmer. Follow the steps in order. Everything here is **free** to start. Expect about an hour the first time.

You will create four free accounts: **GitHub** (stores the code and builds the desktop apps), **Supabase** (the database and logins), **Vercel** (the website), and **Anthropic** (the AI assistant, pay-as-you-go). Email via **Resend** is optional.

> Keep a private note (e.g. in a password manager) of every key you copy. Never send keys by WhatsApp or email, and never paste them into the app's code files.

---

## 0. What you need on your computer

- This folder: `FCA-Stock-Room` (in your home folder).
- **Node.js** is already installed in your home folder (`~/.local/node`). Open **Terminal** and check:

  ```bash
  node -v
  ```

  It should print `v22…`. If it says "command not found", close Terminal and open it again.

To see the app right now in demo mode:

```bash
cd ~/FCA-Stock-Room && npm run dev
```

Then open http://localhost:5173. Press `Ctrl+C` in Terminal to stop it.

---

## 1. Put the code on GitHub

1. Create an account at **github.com** (free).
2. Click **New repository**. Name: `fca-stock-room`. Choose **Public**.
   *Why public:* the desktop apps download their updates from the repository's Releases page, and that only works without a login when the repository is public. The code contains **no passwords or keys**: those are kept in Supabase, Vercel and GitHub "Secrets". If you prefer Private, everything works except automatic updates of the desktop app.
3. On the new repository's page, GitHub shows commands under "…or push an existing repository". In Terminal:

   ```bash
   cd ~/FCA-Stock-Room
   git add -A
   git commit -m "FCA Stock Room"
   git remote add origin https://github.com/YOUR-USERNAME/fca-stock-room.git
   git push -u origin main
   ```

   (Replace `YOUR-USERNAME`. GitHub may ask you to sign in in the browser.)

---

## 2. Create the database (Supabase)

1. Go to **supabase.com** → **Start your project** → sign in with GitHub.
2. **New project**: name `fca-stock-room`, choose a strong database password (save it!), region **Europe (Frankfurt)** or the closest offered to Rwanda. Plan: **Free**.
3. Wait ~2 minutes until the project is ready.
4. Open **SQL Editor** (left menu) → **New query**. Open each file below from the `supabase/migrations` folder in TextEdit, copy **all** of its text, paste into the editor and press **Run**. Do them **in this order**, one at a time:
   1. `0001_schema.sql`
   2. `0002_functions.sql`
   3. `0003_rls.sql`

   Each should end with "Success. No rows returned".
5. Load your 76 items: new query → paste all of `supabase/seed.sql` → **Run**.
   (Alternatively, after step 4 you can sign in as Admin and use **Import from Excel** in the app.)
6. Go to **Project Settings → API**. Copy and save:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`). The part `abcdefgh` is your **project ref**.
   - **anon public** key (long text starting with `eyJ`). This one is safe to be in the website.
   - **service_role** key. **Secret!** Never put it in the app or share it.

### Login settings

7. **Authentication → URL Configuration**:
   - **Site URL**: your website address (you get it in step 4, e.g. `https://fca-stock-room.vercel.app`). Come back and set it after step 4.
   - **Redirect URLs**: add the same address, and `http://localhost:5173`.
8. **Authentication → Providers → Email**: keep it on. "Confirm email" on is safer (people click a link in their email first).
9. *(Optional) Google sign-in:* **Authentication → Providers → Google**. Supabase shows a link to the guide for creating a Google "OAuth client" (free, ~10 minutes in Google Cloud Console). Paste the Client ID and Secret there. Google sign-in works on the website; on the desktop app, use email + password.

---

## 3. Connect the app to the database on your computer

In the folder `apps/web`, copy the file `.env.example` to a new file named `.env` (in Terminal: `cp apps/web/.env.example apps/web/.env`), open it in TextEdit and fill in:

```
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...your anon key...
```

Run `npm run dev` again. The login screen now asks for email and password. **Create your account first**: the first person to sign up becomes **Admin**.

---

## 4. Put the website online (Vercel)

1. Go to **vercel.com** → sign up with GitHub (Hobby plan, free).
2. **Add New → Project** → import `fca-stock-room`.
3. Leave the build settings as they are (they come from `vercel.json`).
4. Open **Environment Variables** and add:
   - `VITE_SUPABASE_URL` = your Project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon key
5. Click **Deploy**. After ~1 minute you get an address like `https://fca-stock-room.vercel.app`. Go back to Supabase step 2.7 and put this address in **Site URL** and **Redirect URLs**.

The website is HTTPS only. Every time you push changes to GitHub, Vercel updates the website automatically.

**Custom domain (later):** in Vercel → Project → **Settings → Domains**, add e.g. `stock.firstchoiceafrica.com` and follow the DNS instructions; then add it to Supabase Redirect URLs too.

---

## 5. Turn on the AI assistant (Claude)

1. Go to **console.anthropic.com**, create an account, add a payment method under **Billing** (pay per use; a typical question costs a few Rwandan francs). You can set a monthly spending limit there.
2. **API Keys → Create Key**. Copy it (starts with `sk-ant-`). **Secret!**
3. Install the Supabase command-line tool and deploy the server functions. In Terminal:

   ```bash
   cd ~/FCA-Stock-Room
   npx supabase login
   npx supabase link --project-ref YOUR-PROJECT-REF
   npm run sync-core
   npx supabase functions deploy ai-assistant
   npx supabase functions deploy monday-summary
   ```

   (`link` asks for the database password from step 2.2.)
4. Save the secret key in Supabase (never in the app):

   ```bash
   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...your key...
   ```

The assistant uses Claude Opus 5.5 by default (`ANTHROPIC_MODEL`), with Anthropic's automatic fallback switched on so a refused request is retried on another model. It is limited to 10 questions per minute and 200 per day per person.

---

## 6. Schedule the Monday summary (07:37 every Monday)

1. Make up a long random password for the schedule (e.g. from your password manager). This is the **cron secret**.
2. Save it in Supabase:

   ```bash
   npx supabase secrets set CRON_SECRET=your-long-random-text APP_URL=https://fca-stock-room.vercel.app
   ```

3. Open `supabase/cron.sql` in TextEdit, replace `<YOUR-PROJECT-REF>` and `<YOUR-CRON-SECRET>`, then paste it into the Supabase SQL Editor and **Run**.

Managers can also press **Write summary now** on the Dashboard at any time.

### Email the summary (optional, free)

1. Create an account at **resend.com** (free: 3,000 emails/month). Under **Domains**, add your company domain and follow the DNS steps, so emails come from e.g. `stock@firstchoiceafrica.com`. (Without a domain, Resend only lets you send to your own address.)
2. **API Keys → Create**. Then:

   ```bash
   npx supabase secrets set RESEND_API_KEY=re_... SUMMARY_FROM_EMAIL="FCA Stock Room <stock@firstchoiceafrica.com>"
   ```

The summary is emailed to everyone with the role Admin, Boss or Manager.

### Phone and browser notifications (optional)

1. Make a key pair:

   ```bash
   npx web-push generate-vapid-keys
   ```

2. Save both in Supabase, and the **public** one in Vercel:

   ```bash
   npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@firstchoiceafrica.com
   ```

   In Vercel → Settings → Environment Variables, add `VITE_VAPID_PUBLIC_KEY` = the public key, then redeploy.
3. Each person opens the app, clicks their name (top right) → **Turn on notifications**. On iPhone, first add the website to the Home Screen (Share → Add to Home Screen), then turn on notifications from there.

The desktop app shows a notification when a new summary arrives while it is open.

---

## 7. Desktop apps for Mac and Windows

The installers are built for you by GitHub (free), so you don't need any extra software.

### One-time setup

1. Make the update-signing key (this makes sure the app only installs updates made by you):

   ```bash
   cd ~/FCA-Stock-Room/apps/desktop
   npx tauri signer generate -w ~/.tauri/fca-stock-room.key
   ```

   Choose a password. It prints a **public key**. Your private key is saved in `~/.tauri/fca-stock-room.key`. **Back up this file.** If you lose it, existing installs cannot auto-update.
2. Open `apps/desktop/src-tauri/tauri.conf.json` in TextEdit:
   - replace `REPLACE_WITH_UPDATER_PUBLIC_KEY` with the public key,
   - replace `REPLACE_OWNER/REPLACE_REPO` with your GitHub username and `fca-stock-room`.
3. On GitHub: your repository → **Settings → Secrets and variables → Actions → New repository secret**. Add:
   - `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (same as Vercel)
   - `TAURI_SIGNING_PRIVATE_KEY` = the whole content of `~/.tauri/fca-stock-room.key` (open it in TextEdit)
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = the password you chose

### Make a release (also how you publish updates)

1. Raise the version number in **both** `apps/desktop/src-tauri/tauri.conf.json` and `apps/desktop/src-tauri/Cargo.toml` (e.g. `1.0.0` → `1.0.1`).
2. In Terminal:

   ```bash
   cd ~/FCA-Stock-Room
   git add -A && git commit -m "Version 1.0.1"
   git tag v1.0.1
   git push && git push --tags
   ```

3. On GitHub, open **Actions** and wait ~15 minutes. Then **Releases** shows the new version with:
   - `FCA Stock Room_1.0.1_universal.dmg` → Mac (Apple Silicon and Intel)
   - `FCA Stock Room_1.0.1_x64-setup.exe` → Windows (or the `.msi`)

Desktop apps already installed check for updates at start and ask before installing.

### Installing on staff computers

- **Mac:** download the `.dmg`, open it, drag **FCA Stock Room** into **Applications**. The first time, macOS may say it "cannot verify the developer": open **System Settings → Privacy & Security**, scroll down, and click **Open Anyway**.
- **Windows:** download the `-setup.exe` and run it. If Windows shows "Windows protected your PC", click **More info → Run anyway**.

These warnings appear because the installers are not code-signed yet. To remove them later (optional, paid):
- **Mac:** Apple Developer Program, $99/year. Add the `APPLE_*` secrets listed in `.github/workflows/desktop.yml` (see tauri.app → Distribute → macOS code signing).
- **Windows:** a code-signing certificate (about $100–300/year), or Microsoft "Trusted Signing" (about $10/month).

---

## 8. Backups

- **Any time:** Admin → **Team → Download full backup** saves every table to one Excel file.
- **Daily automatic:** the free Supabase plan has no daily backup, so GitHub does it every night.
  1. In Supabase: **Project Settings → Database → Connection string → URI** (use the "Session pooler" one). Copy it and put your database password in place of `[YOUR-PASSWORD]`.
  2. On GitHub: **Settings → Secrets → Actions → New secret**: name `SUPABASE_DB_URL`, value = that connection string.
  3. Each night a backup appears under **Actions → Daily backup** → the run → **Artifacts** (kept 30 days). You can also click **Run workflow** to make one now.
- When the budget allows, Supabase **Pro** ($25/month) adds automatic daily backups with point-in-time restore.

---

## 9. Adding staff

1. Send staff the website address (or the desktop installer).
2. They click **Create account**, enter their name, email and a password.
3. They start as **Staff**. As Admin, open **Team** and set each person's role: **Boss** (same rights as Manager), **Manager**, **Staff**, or **Viewer**.

Suggested for your team: 1 Admin, 3 Bosses, 5–6 Managers, 3–4 Staff.

---

## 10. Updating the app later

- **Website:** push to GitHub (`git add -A && git commit -m "…" && git push`). Vercel updates it in about a minute.
- **Desktop:** make a release (step 7). Installed apps update themselves.
- **Database changes:** new files in `supabase/migrations` are run in the SQL Editor in order, or with `npx supabase db push`.
- **Server functions:** `npm run sync-core` then `npx supabase functions deploy ai-assistant` (or `monday-summary`).

## Costs

| Service | Free plan | When you might pay |
|---|---|---|
| Supabase | 500 MB database, 50,000 users | Pro $25/month for daily backups and no pausing after 1 week of no use |
| Vercel | Hobby: free | Pro $20/month only for very high traffic or a team |
| GitHub | Free (public repo, Actions included) | – |
| Anthropic (AI) | Pay per use | Set a monthly limit in the console |
| Resend (email) | 3,000 emails/month | – |

> **Note:** free Supabase projects pause after 7 days with nobody using them. Normal daily use keeps it awake. If it pauses, open the Supabase dashboard and click **Restore**.

## If something goes wrong

- **"Invalid login credentials":** wrong password, or the email isn't confirmed yet (check spam).
- **Login link opens the wrong site:** check Site URL and Redirect URLs (step 2.7).
- **AI says "not available":** check `npx supabase secrets list` shows `ANTHROPIC_API_KEY`, and that the function is deployed. Logs: Supabase → **Edge Functions → ai-assistant → Logs**.
- **No Monday summary:** in the SQL Editor run `select * from cron.job_run_details order by start_time desc limit 5;` to see what happened.
- **Desktop build failed on GitHub:** open the failed run in **Actions** to read the error; most often a secret is missing or misspelled.
