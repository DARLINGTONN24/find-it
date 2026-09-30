# Find It — Deployment Runbook (detailed, first-deploy-friendly)

This guide assumes you have never deployed a web app before. Every step is spelled out —
what to click, what to type, and what you should see at each point. It walks through the
**free, single-service Render.com path**, which is the simplest way to get Find It live
with zero cost and no separate database to manage.

Total time: roughly 20–30 minutes, most of which is waiting for the first build.

---

## Part A — Test it on your own computer first

Skipping this is the #1 cause of confusing deploy failures — if something is broken, it's
much easier to see why on your own machine than in a remote build log.

### A1. Install Node.js

1. Go to https://nodejs.org
2. Download the **LTS** version (not "Current") for your operating system.
3. Run the installer, accepting all defaults.
4. Confirm it worked: open a terminal (Command Prompt/PowerShell on Windows, Terminal on
   Mac/Linux) and type:
   ```bash
   node -v
   ```
   You should see something like `v20.x.x` or `v22.x.x`. If you see "command not found,"
   the install didn't complete — restart your computer and try again.

### A2. Get the project onto your computer

1. Unzip the project zip into a folder, e.g. `Documents/find-it`.
2. Open a terminal and navigate into that folder:
   ```bash
   cd Documents/find-it
   ```
   (adjust the path to wherever you unzipped it)

### A3. Install dependencies

```bash
npm install
```

This downloads all the packages the app needs (Express, the database engine, etc.) into a
new `node_modules` folder. It can take 30 seconds to a few minutes. You'll see a lot of
text scroll past — that's normal. If it ends with a red "npm error," see the
**Troubleshooting** section at the bottom of this file.

### A4. Configure your environment

1. Find the file `.env.example` in the project folder.
2. Make a copy of it and rename the copy to exactly `.env` (no `.example` at the end).
   - On Mac/Linux: `cp .env.example .env`
   - On Windows (PowerShell): `copy .env.example .env`
3. Open `.env` in any text editor (Notepad, VS Code, etc.) and fill in:
   - `SESSION_SECRET` — replace the placeholder with a long random string. You can generate
     one by running `openssl rand -hex 32` in your terminal (Mac/Linux), or just mash your
     keyboard for 40+ random characters.
   - `LOOKUP_SECRET` — same idea, but generate a **different** random string (don't reuse
     the session one).
   - `ADMIN_EMAIL` — the email address you personally want to use as the site administrator.
     Whichever email registers on the site matching this value automatically becomes admin.
   - Leave everything else as-is for local testing.
4. Save the file.

### A5. Start the app

```bash
npm start
```

You should see:
```
Find It listening on 3000
```

If you see an error instead, check the **Troubleshooting** section.

### A6. Open it in your browser

Go to **http://localhost:3000**

You should see the Find It homepage. Now walk through this checklist to confirm every
part of the app genuinely works before you deploy it publicly:

- [ ] Click **Login / Register** → **Register** tab → create an account using the exact
      email you put in `ADMIN_EMAIL`. You should be logged in immediately, and after a
      refresh you should see an **Admin** button appear in the top-right — this confirms
      the admin promotion worked.
- [ ] Log out, then register a **second**, different account (a normal user) to test the
      rest of the flows as a regular member.
- [ ] Go to **Lost & Found** → report a found item with a made-up ID number, pick a city,
      area, and police station from the dropdowns.
- [ ] Search for that same ID number (try typing it with different spacing/dashes than you
      entered it — it should still match).
- [ ] Go to **Market** → post a listing. Then check your admin account's **Admin** page →
      **Market** tab → approve it. Confirm it now shows up on the public Market page.
- [ ] Go to **Accommodation** → post a listing (try both "for rent" and "seeking a place").
      Approve it from the Admin → **Accommodation** tab, confirm it appears publicly.
- [ ] Go to **Jobs** → **Register company** with any made-up registration number. As admin,
      go to Admin → **Recruiters** tab → click **Verify**. Then, back on the recruiter
      account, post a job — it should now be allowed. Approve it from Admin → **Jobs**.
      Apply to it from your other (non-recruiter) test account and confirm no payment or
      fee is ever requested.
- [ ] Try **Forgot your password?** on the login screen — since this project has no email
      service wired up, it will show the reset link directly on screen (clearly labeled
      "Demo mode"). Click it, set a new password, and log in with the new one.
- [ ] Go to **Dashboard → Security** → **Enable 2FA**. Scan the shown secret into an
      authenticator app (Google Authenticator, Authy, etc. — or type the secret in
      manually if you can't scan a QR code from this build), enter the 6-digit code it
      generates, and confirm setup. Save the backup codes shown. Log out and log back in —
      you should now be prompted for a 6-digit code as a second step after your password.
- [ ] While still logged in with 2FA enabled, check **Dashboard → Security → Recent
      sign-in activity** — you should see your own logins listed with timestamps and IP.

If every box above works locally, you're ready to deploy.

---

## Part B — Put the project on GitHub

Render (and most modern hosts) deploy directly from a GitHub repository, so this step is
required even for a single-person project.

### B1. Create a GitHub account

If you don't have one: go to https://github.com → **Sign up** → follow the prompts
(email, username, password, verify your email).

### B2. Create a new repository

1. Once logged in, click the **+** icon in the top-right corner → **New repository**.
2. Repository name: `find-it` (or anything you like, no spaces).
3. Leave it **Public** (Private also works, but Public is simpler for free-tier hosts to
   read from).
4. Do **not** check "Add a README" — you already have one.
5. Click **Create repository**.

### B3. Upload your project files

The easiest way if you're not familiar with `git` commands yet:

1. On your new (empty) repository page, click the link that says
   **"uploading an existing file"**.
2. On your computer, open the `find-it` folder you unzipped earlier.
3. Select **all files and folders inside it** (not the outer zip, the contents) and drag
   them into the GitHub upload box in your browser.
   - Important: do **not** upload your `.env` file, `node_modules` folder, or the `data`/
     `uploads` folders' contents — these are meant to stay local/private. If you followed
     the steps above and only created `.env` locally without adding it to the upload
     selection, you're fine. (The project's `.gitignore` file is configured to skip these
     automatically if you later switch to using real `git` commands.)
4. Scroll down to "Commit changes" → click the green **Commit changes** button.
5. Refresh the page — you should now see all your project files listed in the repository.

*(If you're comfortable with the command line instead, the equivalent is:)*
```bash
git init
git add .
git commit -m "Find It initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/find-it.git
git push -u origin main
```

---

## Part C — Deploy on Render.com (free tier)

### C1. Create a Render account

1. Go to https://render.com
2. Click **Get Started** → **Sign up with GitHub** (this is the easiest option since it
   automatically links your GitHub account, so Render can see your repositories).
3. Authorize Render when GitHub asks for permission.

### C2. Create the web service using the included blueprint

This project includes a `render.yaml` file, which tells Render exactly how to build and
run the app — including setting up the persistent disk your database and uploaded images
need to survive restarts. This means you don't have to configure any of that by hand.

1. On the Render dashboard, click **New +** (top right) → **Blueprint**.
2. Under "Connect a repository," find and select your `find-it` repository.
   - If you don't see it listed, click **Configure account** and grant Render access to
     that repository specifically (GitHub will show a permission screen).
3. Render will detect `render.yaml` and show you a preview of what it's about to create:
   a web service named `find-it-zimbabwe`, with a 1GB persistent disk attached.
4. Click **Apply**.

### C3. Fill in the two required secrets

Render will pause and ask you to provide values for anything in `render.yaml` marked
`sync: false` (meaning "don't auto-generate this, ask the human"):

- **ADMIN_EMAIL** — enter the email address you want to use as the site administrator
  (this can be the same one you tested with locally, or a different real one you'll use
  going forward).
- **PUBLIC_BASE_URL** — you don't know this yet since Render hasn't given you a URL. Leave
  it blank for now; you'll fill it in during step C5 below.

Click **Create Web Service** / **Deploy** to continue.

### C4. Wait for the first build

Render will now:
1. Pull your code from GitHub.
2. Run `npm ci` (install dependencies fresh, including compiling `better-sqlite3`, which
   involves some native code compilation — this is normal and can take a couple of
   minutes).
3. Run `npm start` to boot the server.

You'll see a live log stream on screen. Watch for the line:
```
Find It listening on 3000
```
This confirms the app booted successfully. The whole process usually takes 2–5 minutes
for the first deploy.

If the build fails, check the **Troubleshooting** section below before retrying.

### C5. Get your live URL and finish configuration

1. Once deployed, Render shows your service's URL at the top of the page, e.g.
   `https://find-it-zimbabwe.onrender.com`.
2. Go to your service's **Environment** tab (left sidebar) → find `PUBLIC_BASE_URL` →
   click **Edit** → paste in your actual URL from step 1 (including `https://`) → **Save
   Changes**.
3. Render will automatically redeploy with the new value. Wait for it to finish (you'll
   see "Live" with a green dot once it's ready).

### C6. Visit your live site and confirm it works

1. Open your Render URL in a browser.
2. Go to `/api/health` (e.g. `https://find-it-zimbabwe.onrender.com/api/health`) — you
   should see `{"ok":true,"service":"Find It","version":"2.0"}`. This confirms the API is
   alive.
3. Go back to the homepage and register using the **exact email** you set as
   `ADMIN_EMAIL` in step C3. This account will automatically become the site
   administrator.
4. Re-run through the same testing checklist from Part A6, but on your live URL this time,
   to confirm everything works in the real deployed environment (not just locally).

**You're live.** Share the Render URL with anyone you want to test the platform.

---

## Part D — Optional: use your own domain name

If you'd like `finditzimbabwe.co.zw` (or similar) instead of the `onrender.com` address:

1. Buy a domain from any registrar (e.g. Namecheap, GoDaddy, or a local Zimbabwean
   registrar if one is available for `.co.zw` domains).
2. In Render, go to your service → **Settings** → **Custom Domains** → **Add Custom
   Domain** → enter your domain.
3. Render will show you DNS records (usually a CNAME or A record) to add at your domain
   registrar. Log into your registrar's dashboard, find "DNS settings" or "Manage DNS,"
   and add the records exactly as Render shows them.
4. DNS changes can take anywhere from a few minutes to 24 hours to take effect. Render
   will show a green checkmark once it detects the domain is correctly pointed.
5. Update `PUBLIC_BASE_URL` in your Environment settings to your new domain (e.g.
   `https://finditzimbabwe.co.zw`) and save — this ensures password reset links point to
   the right place.

---

## Part E — What "free tier" actually means here (read before real-world launch)

- Render's free web service tier can **spin down after 15 minutes of no traffic**, and
  takes 30–60 seconds to "wake up" on the next visit. This is fine for testing/demoing,
  but will feel slow for real users. Paid tiers ($7/mo and up, as of writing — verify
  current pricing on Render's site) remove this delay.
- The persistent disk configured in `render.yaml` (1GB) keeps your SQLite database and
  uploaded images safe across redeploys **as long as you stay on a paid instance type
  that supports disks**, or Render's specific free-tier disk terms at the time you
  deploy — these terms change, so check Render's current documentation before assuming
  data will persist indefinitely on a free plan.
- This app currently has **no real email sending** — password reset links are shown
  directly on-screen rather than emailed. This is clearly labeled in the UI as demo
  behavior. Before a real public launch, wire up a transactional email provider (see
  the comment block above the `/api/forgot-password` route in `server.js` for exactly
  where to make that change).
- The app takes its **own automated daily backups** of the database (see SECURITY.md),
  stored alongside the database on the same persistent disk. This protects against
  accidental data corruption or a bad deploy, but **not** against total disk loss — if
  the underlying disk itself fails or is deleted, both the live database and its backups
  disappear together. For real production use, periodically copy the backup files
  somewhere off-host (e.g. download them manually via Render's shell access, or script a
  push to S3-compatible storage) rather than relying solely on the in-app backups.

---

## Troubleshooting

**`npm install` fails with a `node-gyp` or compilation error**
`better-sqlite3` includes native code that sometimes needs to compile from source if a
prebuilt binary isn't available for your system. This usually resolves itself with a
normal internet connection (it needs to reach `nodejs.org` and the npm registry). If it
keeps failing on your own computer, try `npm install --verbose` and read the actual error
near the top of the output — it's usually more specific than the summary at the bottom.

**The app starts locally but "Cannot connect" when I open localhost:3000**
Check the terminal for the actual line "Find It listening on 3000" — if the app crashed
right after starting, the terminal will show a red error instead. Also confirm nothing
else is already using port 3000 on your computer.

**Registering doesn't make me admin**
Double check the email you registered with matches `ADMIN_EMAIL` in your `.env`
**exactly**, including capitalization — the app lowercases both sides for comparison, so
casing shouldn't matter, but typos (extra space, wrong domain) will.

**On Render, the build succeeds but the site shows an error page**
Check the **Logs** tab in your Render service dashboard for the actual crash message.
Common causes: a missing/misspelled environment variable, or the persistent disk not
mounted correctly (check that `DB_FILE` and `UPLOAD_DIR` in your Environment tab match
the paths under `/var/data/...` as set in `render.yaml`).

**Cookies/login don't work after deploying (but worked locally)**
Make sure `NODE_ENV=production` is set in Render's environment variables (it should be,
via `render.yaml`) — this is required for secure cookies to work correctly over HTTPS,
which Render provides automatically.
