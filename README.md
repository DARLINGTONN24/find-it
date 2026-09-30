# FIND IT — Zimbabwe Production-Oriented MVP

A full-stack platform combining:
- Privacy-first Lost & Found (national ID, passport, driver's licence, bank-card recovery reference)
- Zimbabwe location/police-station handover workflow
- Marketplace (cars, furniture, hardware, gadgets) with image galleries, pagination, and optional promotion
- Accommodation (offering a place to rent, or seeking one) with the same moderation and image support as the Market
- Verified-company Jobs with direct applications and no application fees
- User profiles, "my listings" views, in-app messaging, notifications
- **Self-service password reset** and **two-factor authentication (2FA)**
- Trust score / earned "Trusted" badges for consistently good sellers, posters, and recruiters
- Reporting/moderation
- Admin dashboard with tabbed sections (recruiters, market, accommodation, jobs, reports, users, security)
- Layered account and data security (see **SECURITY.md** for the full breakdown)
- Automated database backups
- Safer bank-card workflow

## If you forget your password

Click **"Forgot your password?"** right below the password field on the login screen.
Enter your account email, and the app creates a one-time reset link. Since this build has
no email service configured yet, the link is shown directly on screen instead of being
emailed (clearly labeled as demo behavior in the UI) — click it, choose a new password
(minimum 10 characters), and you're back in. The link expires after 1 hour and can only be
used once. If your account was locked from too many failed login attempts, a successful
password reset also clears that lockout automatically.

Before a real public launch, plug in a real transactional email provider so the link is
actually emailed rather than displayed — see the comment block directly above
`/api/forgot-password` in `server.js` for exactly where that change goes.

## Important privacy rule

Find It does NOT store full bank-card numbers. Bank card reports are refused outright at
the API level — the app tells the person to hand the card to their bank or the police
directly, and never stores CVV, PIN, OTP, magnetic-stripe data, or online-banking
credentials.

For IDs/passports/licences, the exact identifier is normalized (case, spaces, and
punctuation are all ignored) and stored only as a keyed HMAC hash. Search requires login
and an exact identifier match, is aggressively rate-limited beyond the platform's general
limits, and pads every response to a fixed minimum time so response speed can't be used to
guess whether a record exists. A successful result returns controlled recovery
information, not the identifier itself. Full details in **SECURITY.md**.

## Local setup

1. Install Node.js 20+.
2. Extract this project.
3. Run:
   ```
   npm install
   ```
4. Copy `.env.example` to `.env`.
5. Set strong random `SESSION_SECRET` and `LOOKUP_SECRET`.
6. Set `ADMIN_EMAIL` to the first administrator email.
7. Run:
   ```
   npm start
   ```
8. Visit http://localhost:3000

The first account matching `ADMIN_EMAIL` is promoted to admin at login/registration.

For a much more detailed, click-by-click walkthrough of both local testing and deploying
to the internet for free, see **DEPLOYMENT.md**.

## Security features at a glance

Full technical detail lives in **SECURITY.md**, but in short, this build includes:

- **Two-factor authentication (2FA)** — standard TOTP, works with Google Authenticator,
  Authy, 1Password, etc. Optional backup codes for lost-device recovery. Available to any
  account under Dashboard → Security.
- **Account lockout** after 5 failed logins (15-minute cooldown), automatically cleared by
  a successful login or password reset.
- **New-device login alerts** — an in-app notification fires when your account is accessed
  from a browser it hasn't seen before.
- **Escalating lookup lockout** on Lost & Found search specifically (separate from and
  stricter than the site's general rate limiting), tracked by both account and IP address.
- **Hardened security headers** (CSP, HSTS, clickjacking protection, restrictive
  Permissions-Policy) via a properly configured `helmet` setup.
- **Automated daily database backups** with rotation, using `better-sqlite3`'s safe
  online-backup method — visible and manually triggerable from Admin → Security.
- A dedicated `security_events` audit trail (lockouts, 2FA changes, admin unlocks),
  separate from the general activity log, visible to admins.

## What's in this version

- **Accommodation section** — post a place for rent, or post that you're looking for one.
- **Password reset + 2FA** (see above).
- **Pagination** on Market and Accommodation via a "Load more" button.
- **"My Listings" panels** — logged-in users see the status of their own posts without
  needing to ask an admin.
- **Image lightbox** and thumbnail strips for multi-photo listings.
- **Session-expiry banner** — if your login lapses mid-use, you're told, instead of
  requests silently failing.
- **Password strength meter** on registration and password reset.
- **Trust score / Trusted badge** — earned automatically after 30+ points from real
  approved activity (5 points per approved listing/job). Cannot be bought or self-declared.
- **Admin Security tab** — locked accounts (with one-click unlock), security event log,
  backup log with manual trigger.
- **Admin user list** — every registered user, not just pending queues.

## Production deployment

For a small demonstration, this can run on a Node host with a persistent disk (see
`render.yaml`, already configured for this). For a serious public launch, also plan for:
- PostgreSQL for database (once you outgrow SQLite's single-file concurrency model)
- S3-compatible object storage for images/CVs
- HTTPS (automatic on Render)
- transactional email (to replace the on-screen password reset link)
- centralized logs/monitoring beyond the in-app audit tables
- off-host backup copies in addition to the in-app automated backups
- a WAF (e.g. Cloudflare's free tier)
- mandatory (not just optional) MFA for admin accounts
- privacy/retention policies
- legal review under applicable Zimbabwe data-protection and employment requirements

The app intentionally keeps the storage adapter simple so PostgreSQL/object storage can be
swapped in later.

## Free-tier route

A common low-cost/free prototype path is a Node hosting provider plus a small persistent
disk. Free tiers change frequently, so verify the provider's current limits before
choosing one. A static-only host is not enough because Find It needs a server, sessions, a
database, and uploads. **DEPLOYMENT.md** walks through the exact free Render.com setup
step by step.

## Admin

Set `ADMIN_EMAIL` in `.env` (locally) or in your host's environment variables (in
production). When that email registers/logs in, the account becomes admin. Admin can:
- verify/suspend recruiters (**this gate is enforced server-side** — an unverified
  recruiter's job-posting requests are rejected by the API itself, not just hidden in the
  UI)
- approve/reject market listings
- approve/reject accommodation listings
- moderate jobs
- review reports
- inspect the general audit log and the dedicated security-events log
- unlock accounts that are locked from failed login attempts
- trigger a manual database backup on demand
- view the full registered-user list

## Production hardening still recommended

- Email verification (email addresses currently aren't confirmed on signup)
- Requiring (not just offering) MFA for admin accounts
- CSRF tokens if architecture changes to cookie-based cross-site flows
- Virus scanning for uploads
- Image transcoding/resizing on upload, and EXIF stripping
- Content moderation (automated, in addition to the manual admin queue)
- Background jobs
- Object storage (S3-compatible) instead of local disk
- PostgreSQL instead of SQLite
- Data retention/deletion workflows
- Real transactional email (replacing the on-screen password reset link)
- Formal privacy notice and consent records
- Independent security audit/penetration test
