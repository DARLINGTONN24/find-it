# Find It Security & Privacy Checklist

This document describes what is actually implemented today, versus what a real public
launch handling real people's identity documents would still need. Being honest about
this boundary matters more than sounding impressive — no system is "unhackable," and
claiming otherwise would be a disservice to the people trusting this platform with
sensitive documents.

## Verification history

This section exists because a security document that only lists intentions, without
recording what was actually tested and what was found broken, creates false confidence.

- **2026-09**: Live end-to-end testing (real HTTP requests against a running server, not
  just code review) caught two real bugs in the lockout logic, both from the same root
  cause: comparing a JavaScript-generated ISO timestamp (`2026-09-06T05:16:50.540Z`)
  against SQLite's native timestamp format (`2026-09-06 05:16:50`) as raw text inside a
  SQL query. These two formats do not sort correctly against each other as strings, even
  though they look superficially similar.
  - The Lost & Found search lockout (`lookupAttemptsRecently`) was **silently never
    triggering** — 9 rapid search attempts all succeeded when the 9th should have been
    blocked. Fixed by having SQLite compute "now" internally via
    `datetime('now', '-N minutes')` instead of comparing against a JS-side string.
  - The admin "locked accounts" list (`GET /api/admin/locked-accounts`) could show
    accounts whose lock had **already expired**, because the same string-comparison
    approach was used there too. Fixed by filtering candidates through the existing
    `isLocked()` helper, which correctly parses both timestamp formats via `new Date()`
    rather than comparing raw text.
  - Both fixes were re-verified live after the change: the search lockout now correctly
    blocks the 9th attempt, and the admin list correctly reflects only genuinely-locked
    accounts, confirmed via direct API testing including an admin unlock action.
  - Every other date comparison in the codebase was audited for the same pattern; no
    further instances were found — the other lockout/expiry checks (`isLocked()` itself,
    password-reset token expiry) already compared through `new Date()` on both sides,
    which parses either format correctly.

## Sensitive recovery data (Lost & Found) — implemented

- National ID / passport / driver's licence identifiers are never stored in plaintext.
  They are normalized (case, spaces, and punctuation removed) and stored only as a keyed
  HMAC-SHA256 hash using `LOOKUP_SECRET`.
- Bank cards are explicitly refused at the API level (`POST /api/lost` rejects
  `itemType: "bank_card"` outright) — the app tells the person to hand the card to their
  bank or the police directly rather than store any card data at all. This isn't a UI
  suggestion; it's enforced server-side.
- Search requires a logged-in session (`auth` middleware) — there is no public,
  unauthenticated way to query lost items.
- Search requires an **exact** identifier match. There is no partial or fuzzy search on
  identifiers, which would otherwise make guessing dramatically easier.
- Search responses never reveal the identifier that was searched, and a "not found"
  response is worded identically regardless of how close the guess was.
- **Escalating lockout on lookups specifically**: a maximum of 8 search attempts per 15
  minutes, tracked by **both** the logged-in account and the requester's IP address
  (`Math.max()` of the two counts) — so creating multiple accounts from the same network to
  get around the per-account limit doesn't work. This is on top of the general rate
  limiter (`searchRL`) that applies to that route.
- **Fixed-floor response timing**: every search response is padded to take at least 250ms,
  regardless of whether a match was found. Without this, an attacker could potentially
  infer "found vs. not found" purely from how fast the response comes back (a real class
  of vulnerability called a timing side-channel).
- Every lookup attempt is logged to `lost_lookup_attempts` (item type + match result only —
  never the identifier itself) for abuse monitoring.

## Accounts — implemented

- Passwords are bcrypt-hashed (cost factor 10-12).
- Production cookies (`NODE_ENV=production`) use `secure`, `httpOnly`, and `sameSite`
  protections.
- **Password reset is fully implemented**: "Forgot your password?" on the login screen.
  - Reset tokens are single-use and expire after 1 hour.
  - Tokens are stored as SHA-256 hashes, never in plaintext, so a database read alone
    can't be used to forge a valid reset link.
  - The forgot-password endpoint returns an **identical response** whether or not the
    email is registered, so it can't be used to discover which emails have accounts on
    the platform (a common real-world leak in poorly built reset flows).
  - Successfully resetting a password also clears any active account lockout and
    invalidates any other outstanding reset tokens for that account, and sends the user an
    in-app notification so they'd notice if it wasn't actually them.
  - **Known limitation**: the reset link is currently displayed on-screen rather than
    emailed, since no email provider is configured in this build. This is clearly labeled
    in the UI as demo behavior. Before real public launch, wire up a transactional email
    provider — see the comment block directly above `/api/forgot-password` in `server.js`
    for exactly where to make that change.
- **Two-factor authentication (2FA) is fully implemented**, not just planned:
  - Standard TOTP (RFC 6238), compatible with Google Authenticator, Authy, 1Password, and
    similar apps.
  - Implemented directly on Node's built-in `crypto` module rather than a third-party
    package — smaller dependency surface, nothing extra to audit or keep patched.
  - 8 one-time backup codes are issued when 2FA is enabled, for the case where someone
    loses access to their authenticator app. Each is usable exactly once.
  - Disabling 2FA requires re-entering your password.
  - Login with 2FA enabled is a two-step flow: correct password first establishes a
    short-lived "pending" state, then a valid TOTP code (or backup code) is required to
    actually establish the session. A stolen password alone is not sufficient to log in.
- **Account lockout**: 5 failed login attempts locks the account for 15 minutes. A
  successful login (or a successful password reset) clears the counter.
- **New-device detection**: logging in from a browser/user-agent combination not seen
  before on that account triggers an in-app notification, so account takeover attempts are
  visible to the real owner.
- Every login attempt (success and failure) is recorded in `login_history`, visible to the
  user themselves under Dashboard → Security, and to admins in aggregate under
  Admin → Security.
- A separate `security_events` table (distinct from the general `audit_logs` activity log)
  records lockouts, 2FA changes, backup-code use, and admin unlock actions — visible to
  admins under Admin → Security.

### Still recommended before handling real users' documents at meaningful scale

- Email verification on signup (email addresses are not currently confirmed as belonging
  to the person who typed them).
- Consider requiring 2FA (not just offering it) for admin accounts specifically.
- Consider requiring 2FA for recruiter accounts, given they see applicant contact details.
- A real security review/penetration test by a professional before handling ID/passport
  data at real-world scale — this document describes what's built, not a substitute for
  independent verification.

## Infrastructure — implemented

- **Security headers**: `helmet` is configured with a real Content-Security-Policy (no
  inline scripts, no third-party script origins allowed), HSTS (forces HTTPS for a year
  once visited), clickjacking protection (`frameAncestors: 'none'`), MIME-sniffing
  protection, and a restrictive Permissions-Policy (geolocation/camera/microphone/payment
  APIs all blocked).
- **Automated backups**: the app takes a hot/online backup of the SQLite database on boot
  and every 24 hours after, using `better-sqlite3`'s built-in `.backup()` method (safe to
  run while the app is serving live traffic — unlike copying the file directly, which can
  grab it mid-write and produce a corrupt copy). Old backups are rotated automatically,
  keeping the most recent `BACKUP_KEEP_COUNT` (default 14, i.e. ~2 weeks of daily backups).
  Admins can also trigger a manual backup on demand from Admin → Security.
  - **Known limitation**: this backup runs from inside the same Node process as the app
    itself. If the process crashes hard or the host's disk fails entirely, an in-process
    backup can't save you. For real production use, also configure your hosting platform's
    own independent backup/snapshot feature if it offers one, and/or periodically copy
    the `BACKUP_DIR` contents off-host (e.g. to object storage) — see DEPLOYMENT.md.
- **Rate limiting** is applied per-route with different strictness depending on
  sensitivity: general auth routes (30/15min), login specifically (15/15min, tighter since
  it's the most common brute-force target), and lost-item search (10/15min at the HTTP
  layer, with the additional 8/15min escalating lockout described above underneath it).

### Still recommended before real public launch

- Centralized log aggregation/monitoring (currently logs go to the process's stdout and
  the in-app `audit_logs`/`security_events` tables — fine for a single small instance, not
  yet built for scale or for alerting a human when something looks wrong).
- A Web Application Firewall (WAF) in front of the app (Cloudflare's free tier is a
  reasonable starting point).
- Formal dependency vulnerability scanning as part of your deploy pipeline — run
  `npm audit` periodically at minimum; consider GitHub's free Dependabot alerts once the
  repo is on GitHub.
- If you outgrow SQLite's single-file model (meaningful concurrent write load), migrate to
  PostgreSQL — the query patterns in `server.js` are simple enough that this is a
  moderate, not massive, rewrite.

## Uploads

Before public launch:
- virus/malware scan uploads;
- verify file signatures, not only MIME types;
- transcode images;
- strip EXIF metadata (photos can carry embedded GPS location data);
- store uploads in object storage rather than local disk;
- use private signed URLs for CVs rather than a public static directory;
- never expose CVs through a public static directory (currently `/api/images/:name` is
  used for market/accommodation photos, which is fine for public listing photos, but CV
  files should not be served the same way once implemented with real storage).

## Moderation — implemented

- Recruiters must submit company registration details and be verified by an admin before
  any job they post becomes visible — enforced server-side, not just hidden in the UI.
- Market listings, accommodation listings, and jobs all require admin approval before
  appearing publicly.
- A trust score / "Trusted" badge is awarded automatically once an account accumulates 30+
  points from real approved activity (5 points per approved listing/job) — this cannot be
  bought or self-declared, only earned through a track record the admin has already
  reviewed.
- A reports table and admin review queue exist for user-submitted reports.

### Still recommended

- Automated content moderation (image/text scanning) in addition to the manual admin
  queue, especially as volume grows beyond what a human can review promptly.
- Suspend/ban workflows beyond simple listing rejection.

## Data governance

Define, and have a qualified Zimbabwe privacy/legal professional review, before real
public launch:
- purpose for every sensitive field collected;
- retention period (how long are hashed identifiers, login history, and security events
  kept, and why);
- deletion process (what happens when a user asks to delete their account/data);
- correction process (what happens when someone's stored name/details are wrong);
- account data export process;
- who inside the organization can access admin-level data, and how that access itself is
  logged;
- incident/breach response process — who is notified, how, and within what timeframe, if
  the database is ever compromised.

This checklist reflects the code as of this build. If you extend the app further, update
this file alongside the change — a security document that silently drifts out of date is
worse than no document at all, because it creates false confidence.
