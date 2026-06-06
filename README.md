# OmniDock

OmniDock is an open-source, self-hosted email operations dashboard for Cloudflare Workers, Cloudflare Email Routing, Cloudflare Email Sending, D1, and R2.

It turns a Cloudflare account into a compact Linux-style work dock for domain email, support inboxes, contacts, signatures, attachments, and R2 files.

Website: [omnidock.com](https://omnidock.com)

## What It Does

- Receive inbound mail through a Cloudflare Worker `email()` handler.
- Store message and thread metadata in Cloudflare D1.
- Store raw MIME messages, attachments, and manual files in Cloudflare R2.
- Send replies and outbound messages through Cloudflare Email Sending.
- Sync Cloudflare zones, Email Sending status, Email Routing status, catch-all state, and mailbox routing rules.
- Manage multiple domains and mailbox addresses from one dashboard.
- Route one mailbox address or all unmatched domain mail with catch-all.
- Search inbox, sent, and archive across subject, body, sender, and recipient.
- Archive, unarchive, and delete threads.
- Compose rich email with bold, italic, underline, text color, background color, links, and attachments.
- Preview PDF, image, text, and supported attachment files before download.
- Import contacts manually or from CSV, TXT, and VCF files; edit contacts one by one; store phone, company, tags, and notes.
- Manage mailbox-specific rich signatures with text style and links.
- Add external account profiles for Gmail, Outlook, Yahoo, iCloud, or custom IMAP/SMTP settings. OmniDock stores the Worker secret name, not the credential value.
- Browse the configured R2 bucket from the sidebar, open folders, preview objects, upload files, download files, and delete files.
- Choose between five UI palettes: Linux, Ubuntu, Fedora, Plasma, and Graphite.
- Set a default mailbox and customize automatic refresh timing.

OmniDock is not an IMAP/POP3 server and does not replace a full hosted mailbox provider. It is best for private support inboxes, project inboxes, catch-all workflows, domain operations, and lightweight email management that already lives on Cloudflare.

## Screenshots

The default Linux palette is compact and terminal-like, with mailbox selection, inbox/sent/archive folders, Cloudflare sync, buckets, and compose controls on one screen.

![OmniDock Linux inbox](docs/screenshots/omnidock-inbox-linux.png)

Domain routing, catch-all, mailbox rules, contacts, external accounts, signatures, and refresh settings live under Settings so the inbox stays focused.

![OmniDock rules and domain settings](docs/screenshots/omnidock-rules-linux.png)

## Why Fork First

Do not deploy OmniDock directly from the upstream repository. Fork it first, then deploy your own fork.

That gives you:

- A repository you control.
- A clean place to keep your own deployment settings.
- Safer future updates.
- No one-click deploy magic that hides Cloudflare bindings from you.

Recommended install flow:

1. Fork this repository.
2. Open Cloudflare Workers & Pages.
3. Create a D1 database and an R2 bucket.
4. Create a Worker from Git and select your fork.
5. Add the build variables listed below in `Settings > Build > Build configuration`.
6. Set the deploy command to the binding-safe command listed below.
7. Add runtime variables and secrets in Worker settings.
8. Open the Worker URL and finish setup inside OmniDock.

## Critical Binding Rule

Cloudflare Wrangler treats the deploy config as the source of truth. If you add D1 or R2 only in the dashboard and then deploy from Git with a config that does not contain those bindings, Wrangler can remove them.

OmniDock avoids that by generating `DB` and `MAIL_BUCKET` into the deploy config from build variables:

- `OMNIDOCK_D1_DATABASE_ID`
- `OMNIDOCK_R2_BUCKET_NAME`

The legacy `EMAILFOX_D1_DATABASE_ID`, `EMAILFOX_D1_DATABASE_NAME`, and `EMAILFOX_R2_BUCKET_NAME` names are still accepted for existing installs, but new installs should use `OMNIDOCK_*`.

New installs use the Worker script name `omnidock`. If you are updating an older install and want to keep the old Worker script name, add `WORKER_SCRIPT_NAME` as a build variable with the current deployed Worker name before deploying.

Use these Cloudflare Workers Builds commands:

| Cloudflare field | Recommended value |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `node tools/deploy-preserving-bindings.mjs` |

Alternative: leave Build command empty and set Deploy command to:

```bash
npm run deploy
```

Do not use a bare deploy command of `npx wrangler deploy` for normal Git updates.

## 0. Prepare Cloudflare

Before deploying, prepare these items.

### Cloudflare Account

You need a Cloudflare account with Workers enabled. Production email routing also requires at least one active Cloudflare-managed domain.

### Domain

Add your email domain to Cloudflare and make sure the zone is active.

Examples:

- `example.com`
- `company.com`
- `support.example.com`

### Email Sending

Enable Cloudflare Email Sending for every domain or subdomain you want to send from.

OmniDock can send only from mailbox addresses that exist in D1 and belong to a Cloudflare-verified sending domain.

### Email Routing

Enable Cloudflare Email Routing for every domain that should receive mail.

In OmniDock you can choose one of two routing styles:

- Mailbox rule: route a single address such as `support@example.com` to the Worker.
- Catch-all: route all unmatched addresses for the domain to the Worker.

Mailbox rules are safer for most setups. Catch-all is powerful, but it also receives misspelled and unknown addresses.

### D1 And R2

Create:

- One D1 database for metadata.
- One R2 bucket for raw messages, attachments, and manual files.

Suggested names:

```bash
omnidock-db
omnidock-mail
```

The actual D1 `database_id` and R2 bucket name must be added as build variables so updates do not disconnect bindings.

### Cloudflare Automation Token

OmniDock requires `CLOUDFLARE_API_TOKEN` before first setup. The token is used to verify Cloudflare inventory and automate Email Routing checks, Email Sending checks, catch-all setup, and mailbox routing rule creation.

Recommended permissions:

- Account > Account > Read
- Account > Email Sending > Read
- Zone > Zone > Read
- Zone > Email Routing > Read
- Zone > Email Routing > Edit
- Account > Workers Scripts > Read

If the token can access exactly one Cloudflare account, OmniDock detects that account automatically. If it can access multiple accounts, also add `CLOUDFLARE_ACCOUNT_ID`.

## Cloudflare Build Variables

Add these under:

`Worker > Settings > Build > Build configuration > Variables and secrets`

These values are build-time values. They are used to deploy the Worker with correct D1/R2 bindings. They are not app runtime secrets.

| Name | Value to type | Required |
| --- | --- | --- |
| `OMNIDOCK_D1_DATABASE_ID` | Your D1 database id | Yes |
| `OMNIDOCK_R2_BUCKET_NAME` | Your R2 bucket name, for example `omnidock-mail` | Yes |
| `OMNIDOCK_D1_DATABASE_NAME` | D1 display name, for example `omnidock-db` | Optional |
| `WORKER_SCRIPT_NAME` | Current deployed Worker script name, for example `omnidock` | Optional, useful when preserving an older Worker name |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id | Only if the build token can access multiple accounts |

If these values are missing during a Git update, OmniDock may stop the deploy to protect existing `DB` and `MAIL_BUCKET` bindings from being removed.

## Runtime Variables And Secrets

After deploy, open:

`Worker > Settings > Variables and Secrets > Add`

Use `Secret` only for sensitive values. Use plaintext variables for non-sensitive routing and display values.

Cloudflare does not create empty variable rows from the repository. Add one row for each value you need: choose `Type`, paste the exact `Name`, type your own `Value`, then save.

| Type | Name | Value to type | When to add |
| --- | --- | --- | --- |
| Secret | `ADMIN_PASSWORD` | First admin password, at least 12 characters | Required before first setup |
| Plaintext variable | `PRIMARY_DOMAIN` | First managed email domain, for example `example.com` | Required before first setup |
| Secret | `CLOUDFLARE_API_TOKEN` | Cloudflare API token | Required before first setup |
| Plaintext variable | `R2_BUCKET_NAME` | R2 bucket display name, for example `omnidock-mail` | Optional, shown in the Buckets sidebar |
| Plaintext variable | `WORKER_SCRIPT_NAME` | Deployed Worker script name, for example `omnidock` | Add when OmniDock should create Email Routing rules |
| Plaintext variable | `MANAGEMENT_HOST` | Custom dashboard hostname, for example `mail.example.com` | Optional |
| Plaintext variable | `PASSWORD_RESET_FROM` | Verified reset sender, for example `no-reply@example.com` | Optional |
| Plaintext variable | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id | Only if one token can access multiple accounts |

`PRIMARY_DOMAIN`, `R2_BUCKET_NAME`, `WORKER_SCRIPT_NAME`, `MANAGEMENT_HOST`, `PASSWORD_RESET_FROM`, and `CLOUDFLARE_ACCOUNT_ID` are not secrets.

Do not add `ADMIN_PASSWORD` or `CLOUDFLARE_API_TOKEN` as plaintext variables.

## Required Bindings

D1, R2, and Email Sending are bindings, not secrets.

| Binding name | Resource |
| --- | --- |
| `DB` | Cloudflare D1 database |
| `MAIL_BUCKET` | Cloudflare R2 bucket |
| `EMAIL` | Cloudflare Email Sending binding |

The running Worker must receive `DB` as a D1 binding and `MAIL_BUCKET` as an R2 binding. `R2_BUCKET_NAME` is only a display variable for the Buckets UI; it does not grant R2 access.

## First Login

After deploy:

1. Open the Worker URL shown by Cloudflare.
2. If OmniDock lists missing setup, add the listed bindings, variables, or secrets in Cloudflare Worker settings.
3. Complete the setup screen with name, email, recovery email, primary domain, and admin password.
4. The admin password must match the `ADMIN_PASSWORD` secret for first setup.
5. OmniDock stores the password as a salted PBKDF2 hash in D1.
6. Create mailbox addresses such as `support`, `info`, or `billing`.
7. Use `Settings > Rules` to route addresses or enable catch-all.
8. Click `Sync Cloudflare` to refresh Cloudflare inventory and routing checks.

The recovery email must be outside the primary domain. Use Gmail, iCloud, Outlook, a company mailbox, or another address that will still work if the managed domain has a routing issue.

## Main App Areas

### Mail

The Mail view supports inbox, sent, archive, search, rich compose, attachments, thread actions, and mailbox scoping. You can choose all mailboxes or a single mailbox from the top search area.

### Rules

Rules manages Cloudflare zones, sending status, routing status, catch-all, mailbox routing rules, and the default domain. Domain creation is handled from Cloudflare sync; mailbox addresses are created for the selected domain.

### Contacts

Contacts supports manual creation, one-by-one editing, deletion, phone numbers, company, tags, notes, and CSV/TXT/VCF imports with an import report.

### Signatures

Signatures are mailbox-based and support rich text, links, colors, and an HTML preview path. Enabled signatures are appended when composing from that mailbox.

### External Accounts

External account profiles let you document Gmail, Outlook, Yahoo, iCloud, or custom IMAP/SMTP settings. OmniDock stores the credential secret name and connection metadata in D1. Put real app passwords or OAuth secrets in Cloudflare Worker secrets, not in D1 and not in the repository.

### Other Settings

Other Settings controls automatic refresh. The default is 10 seconds and can be changed from the UI.

### Buckets

The Buckets sidebar opens the configured `MAIL_BUCKET` R2 bucket. You can browse folder prefixes, preview supported file types, upload files, download objects, and delete objects.

## Custom Domain

The public template intentionally does not include a personal custom domain in `wrangler.jsonc`.

To use your own management host, add a custom domain in Cloudflare Workers, then set `MANAGEMENT_HOST` as a plaintext variable.

You can also leave `MANAGEMENT_HOST` blank and use the generated `workers.dev` URL.

## Manual Install

Use this path if you deploy from your own machine instead of Cloudflare Git deploy.

Install dependencies:

```bash
npm install
```

Create D1 and R2:

```bash
npx wrangler d1 create omnidock-db
npx wrangler r2 bucket create omnidock-mail
```

For a dashboard-managed install, add these resources in Cloudflare and keep the build variables set so updates do not remove them:

- `DB` -> the D1 database
- `MAIL_BUCKET` -> the R2 bucket
- `EMAIL` -> Cloudflare Email Sending

For a private Wrangler-managed install, add your own D1 `database_id` and R2 `bucket_name` to your private fork's `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "omnidock-db",
    "database_id": "your-d1-database-id"
  }
],
"r2_buckets": [
  {
    "binding": "MAIL_BUCKET",
    "bucket_name": "omnidock-mail"
  }
]
```

Build and deploy:

```bash
npm run deploy
```

If your private `wrangler.jsonc` contains the `DB` binding and you want to run migrations explicitly before deploy, use:

```bash
npm run deploy:with-migrations
```

Wrangler secret equivalents:

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put CLOUDFLARE_API_TOKEN
```

Set plaintext variables such as `PRIMARY_DOMAIN`, `WORKER_SCRIPT_NAME`, `MANAGEMENT_HOST`, `PASSWORD_RESET_FROM`, `R2_BUCKET_NAME`, and `CLOUDFLARE_ACCOUNT_ID` in the Cloudflare dashboard. For private installs only, you may keep plaintext values under `vars` in your private `wrangler.jsonc`; do not commit personal values to a public fork.

## Local Development

Create `.dev.vars` only if you need local-only secret values:

```bash
touch .dev.vars
```

Do not commit `.dev.vars`.

```dotenv
# optional local secrets
# ADMIN_PASSWORD=
# CLOUDFLARE_API_TOKEN=

# optional local plaintext variables
# PRIMARY_DOMAIN=
# PASSWORD_RESET_FROM=no-reply@example.com
```

If you want local sample data, add this only to your local `.dev.vars`:

```dotenv
ENABLE_DEV_SEED=true
```

Run the Worker API:

```bash
npm run dev:worker
```

Run the Vite UI:

```bash
npm run dev
```

Vite proxies `/api` to `http://127.0.0.1:8787`.

For local sample data after migrations:

```bash
curl -X POST http://127.0.0.1:8787/api/dev/seed \
  -H "Authorization: Bearer $ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  -d "{}"
```

The seed endpoint is disabled unless `ENABLE_DEV_SEED=true`.

## Architecture

| Layer | Technology |
| --- | --- |
| UI | React + Vite |
| Runtime | Cloudflare Workers |
| Static assets | Workers assets binding |
| Inbound email | Cloudflare Email Routing to Worker `email()` handler |
| Outbound email | Cloudflare Email Sending binding |
| Metadata | Cloudflare D1 |
| Raw mail, attachments, manual files | Cloudflare R2 |
| Admin auth | D1-stored salted PBKDF2 password hash |
| Cloudflare automation | Cloudflare API token stored as Worker secret |

## Security Notes

- Do not commit `.dev.vars`.
- Do not commit API tokens, admin passwords, app passwords, OAuth secrets, D1 ids from private installs, or personal domains.
- Use least-privilege Cloudflare API tokens.
- Store external email credentials as Worker secrets; OmniDock stores only the secret name.
- Password reset tokens are stored hashed in D1 and expire after 30 minutes.
- OmniDock only sends from enabled D1 mailbox addresses on verified sending domains.
- The browser stores the admin password in `sessionStorage` for the current session. For a larger public SaaS deployment, replace this with HttpOnly session cookies and CSRF protection.
- The default public template has no custom domain, account id, D1 id, R2 bucket, token, password, or personal email baked into source control.

## Useful Commands

```bash
npm run types
npm run check
npm run build
npm run deploy
npm run db:migrate:local
npm run db:migrate:remote
```

## Public Repository Checklist

Before making your repository public:

- Confirm `wrangler.jsonc` does not contain your personal account id, D1 id, R2 bucket name, custom domain, or personal email.
- Confirm `.dev.vars` is not tracked.
- Confirm docs/screenshots do not show private domains or real emails.
- Confirm Cloudflare build variables use `OMNIDOCK_*` names.
- Confirm the README uses the fork-first install flow and does not include a one-click deploy button.
- Run `npm audit --audit-level=moderate`.
- Run `npm run build`.

## License

OmniDock is released under the MIT License. See [LICENSE](LICENSE).

## SEO Description

Meta title: OmniDock - open-source Cloudflare Workers email dashboard

Meta description: OmniDock is an open-source Cloudflare Workers email dashboard for multi-domain inboxes, Email Routing, Email Sending, D1, R2, contacts, signatures, attachments, and support workflows.

SEO copy: OmniDock is a self-hosted Cloudflare email management dashboard built for teams that want a private support inbox, multi-domain email routing, Cloudflare Email Sending, Cloudflare Email Routing, D1 metadata storage, R2 attachment storage, contact management, rich signatures, external account profiles, and an R2 file manager in one open-source Workers app.

Keywords: Cloudflare email dashboard, Cloudflare Workers email app, Cloudflare Email Routing UI, Cloudflare Email Sending dashboard, open-source support inbox, D1 email database, R2 file manager, self-hosted email management, multi-domain email inbox, Cloudflare support inbox.
