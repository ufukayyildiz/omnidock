# EmailFox

Emailfox is a private, multi-domain email management panel for Cloudflare Workers, Cloudflare Email Sending, Cloudflare Email Routing, D1, and R2.

It gives you a compact Linux-style webmail/support inbox for domains in your own Cloudflare account:

- Receive routed email in a Cloudflare Worker `email()` handler
- Store thread metadata in D1
- Store raw MIME messages and attachments in R2
- Send replies through Cloudflare Email Sending
- Sync Cloudflare zones, Email Sending status, and Email Routing status
- Create mailbox addresses and Worker routing rules from the UI
- Import contacts manually or from CSV/TXT/VCF files into D1
- Manage mailbox-specific signatures
- Send outbound attachments while storing copies in R2
- Choose between five UI palettes: Linux, Ubuntu, Fedora, Plasma, Graphite

Emailfox is not an IMAP/POP3 server and does not replace a full mailbox provider. It is best for private support inboxes, project inboxes, catch-all workflows, and lightweight multi-domain email operations that already live on Cloudflare.

## Fork-First Deploy

Do not deploy Emailfox directly from the upstream repository. Fork it first, then deploy your own fork. That gives you a repository you control, keeps generated D1/R2 resource IDs in your copy, and makes future updates safer.

Recommended install flow:

1. Click `Fork` on GitHub and create your own copy of this repository.
2. Open Cloudflare Workers & Pages.
3. Create a Worker from Git and select your fork.
4. In Cloudflare's deploy form, create or select the D1 database and R2 bucket.
5. Deploy.
6. Open the Worker URL and finish Emailfox setup inside the app.

The first deploy should not ask for an Emailfox domain or `CLOUDFLARE_API_TOKEN`. Emailfox asks for the primary domain, admin details, recovery email, and password on the first login screen. Cloudflare automation tokens are advanced and can be added later.

If Cloudflare's generic Git import screen skips the D1/R2 resource step, the build guard stops the deploy until those resources are configured.

## Updating an Existing Install

For updates, use your fork. Pull or merge Emailfox upstream updates into that fork, keep the generated `database_id` and `bucket_name` values in its `wrangler.jsonc`, then let Workers Builds run `npm run deploy`.

The deploy script does not create databases. It runs pending migrations against the existing `DB` binding and then deploys the Worker:

```bash
npm run build && npm run db:migrate:remote && wrangler deploy
```

## 0. Prepare Cloudflare First

Before deploying Emailfox, prepare these items.

### Cloudflare Account

You need a Cloudflare account with Workers enabled and at least one domain managed by Cloudflare if you want production email routing.

### Domain

Add your domain to Cloudflare and make sure the zone is active.

Examples:

- `example.com`
- `company.com`
- `support.example.com`

### Email Sending

Enable Cloudflare Email Sending for every domain or subdomain you want to send from.

Emailfox can only send from a domain marked as verified by Cloudflare and synced into D1.

### Email Routing

Enable Cloudflare Email Routing for every receiving domain.

For inbound mail, you will later choose one of these routing modes in Emailfox:

- Mailbox rule: route one address such as `support@example.com` to the Worker.
- Catch-all: route all unmatched addresses for the domain to the Worker.

Mailbox rules are safer for most setups. Catch-all is powerful, but it also receives misspelled and unknown addresses.

### First Admin Account

After the first deploy and D1 migration, open the Emailfox URL. If no admin account exists, Emailfox shows the setup screen and asks for:

- Name
- Email
- Recovery email, required and outside the primary domain
- Primary domain
- Password

The recovery email is the password reset recipient. Use an external address such as a Gmail, iCloud, Outlook, or company mailbox that is not under the primary Emailfox domain.

The password is stored only as a salted PBKDF2 hash in D1.

`ADMIN_PASSWORD_BOOTSTRAP` is optional and exists only for legacy or automated installs. Normal public deploys can leave it blank.

### Advanced Cloudflare Automation

Emailfox can be deployed without a runtime Cloudflare API token. In that mode, the inbox, setup, D1, R2, contacts, signatures, sending from configured addresses, and manual domain management can still work.

Add `CLOUDFLARE_API_TOKEN` later only if you want Emailfox to call the Cloudflare API for zone inventory, Email Routing status, Email Sending status, catch-all setup, and mailbox routing rule creation.

Cloudflare Workers Builds can create its own deploy token during the Deploy to Cloudflare flow. That dropdown token is only for building and deploying the Worker. It is not the same as Emailfox's optional runtime `CLOUDFLARE_API_TOKEN`.

Recommended permissions:

- Account > Account > Read
- Account > Email Sending > Read
- Zone > Zone > Read
- Zone > Email Routing > Read
- Zone > Email Routing > Edit
- Account > Workers Scripts > Read

If your token can access exactly one Cloudflare account, Emailfox detects that account automatically. If your token can access multiple accounts, add `CLOUDFLARE_ACCOUNT_ID` later as an advanced non-secret Worker variable in your private installed copy.

## Deploy Flow Inputs

During one-click deploy, Cloudflare reads:

- `wrangler.jsonc` for Worker, D1, R2, and assets
- `package.json` scripts and Cloudflare binding descriptions

The `API token` dropdown in Cloudflare's deploy screen is for Workers Builds, meaning the token Cloudflare uses to build and deploy this repository. Emailfox's optional runtime `CLOUDFLARE_API_TOKEN` is advanced and is intentionally not part of the one-click deploy form.

You should only need to configure Cloudflare resources during deploy:

| Value | Required | Notes |
| --- | --- | --- |
| D1 database name | Yes | Default is `emailfox-db`; Cloudflare can provision it. |
| R2 bucket name | Yes | Cloudflare can provision it during deploy. |

Domain, admin name, recovery email, and password are configured later in Emailfox's first setup screen. No secrets are required during the first one-click deploy. Do not put real values in `wrangler.jsonc`, README files, screenshots, issues, or commits.

Advanced/manual installs may also add non-secret Worker vars later:

- `MANAGEMENT_HOST` for a custom dashboard hostname.
- `PASSWORD_RESET_FROM` for a verified password reset sender. If omitted, Emailfox sends reset mail from `emailfox@<default-domain>`.
- `CLOUDFLARE_ACCOUNT_ID` when one API token can access multiple Cloudflare accounts.
- `WORKER_SCRIPT_NAME` when you want Emailfox to create Email Routing rules automatically. Set it to the deployed Worker script name.

These advanced values are intentionally not part of the one-click deploy form.

Advanced/manual installs may also add the `CLOUDFLARE_API_TOKEN` secret later to enable Cloudflare sync and routing automation.

`database_id` is not a Worker secret, but it is account-specific. The public template uses the placeholder `00000000-0000-0000-0000-000000000000` so the Deploy to Cloudflare resource step can replace it with the deployer's own generated D1 database id. Installed copies must keep that generated `database_id` for updates. For a private/manual deployment, add the deployer's own `database_id` locally or through the deploy platform configuration, never as a committed personal value.

The deploy script runs:

```bash
npm run build && npm run db:migrate:remote && wrangler deploy
```

`npm run build` first runs `tools/validate-deploy-config.mjs`. The build stops if the D1 `database_id` is still the placeholder UUID or if the R2 bucket binding is missing. Maintainers working on the public template can bypass only this local template check with `EMAILFOX_SKIP_CONFIG_CHECK=1 npm run build`.

Cloudflare provisions the D1/R2 resources before running the configured deploy command in the one-click flow. The migration command then uses the binding name `DB`, which is important because deployers may rename the actual D1 database.

Emailfox also performs a defensive schema check during setup and inbound email handling. If a deploy platform creates D1 but skips or interrupts the migration step, the Worker can complete the current schema on the existing `DB` binding and mark the bundled migrations as applied. It does not create a new D1 database.

If the Cloudflare setup screen asks for commands, use:

- Build command: `npm run build`
- Deploy command: `npm run deploy`

## First Login

After deploy:

1. Open the Worker URL shown by Cloudflare.
2. Complete the setup screen with name, email, recovery email, primary domain, and password.
3. Log in with the password you just created.
4. Create mailboxes such as `support`, `info`, or `billing`.
5. Use `Settings > Rules` to route addresses to the Worker.
6. Optional: add the advanced `CLOUDFLARE_API_TOKEN` secret, then click `Sync Cloudflare` to automate Cloudflare inventory and routing checks.

## Custom Domain

The public template intentionally does not include a personal custom domain in `wrangler.jsonc`.

To use your own management host, add a custom domain in Cloudflare Workers, then set:

```jsonc
"vars": {
  "MANAGEMENT_HOST": "mail.example.com"
}
```

You can also keep `MANAGEMENT_HOST` blank and use the generated `workers.dev` URL.

## Manual Install

Use this path if you do not want the one-click deploy flow.

Install dependencies:

```bash
npm install
```

Create D1 and R2:

```bash
npx wrangler d1 create emailfox-db
npx wrangler r2 bucket create emailfox-mail
```

If you created resources manually, update `wrangler.jsonc` with your D1 `database_id` and R2 `bucket_name`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "emailfox-db",
    "database_id": "your-d1-database-id"
  }
],
"r2_buckets": [
  {
    "binding": "MAIL_BUCKET",
    "bucket_name": "emailfox-mail"
  }
]
```

For one-click deploy, leave these resource IDs out and let Cloudflare provision them.

Optional advanced Cloudflare automation secret:

```bash
npx wrangler secret put CLOUDFLARE_API_TOKEN
```

Only set `CLOUDFLARE_API_TOKEN` if you want Emailfox to sync Cloudflare inventory or create Email Routing rules automatically. Only set `ADMIN_PASSWORD_BOOTSTRAP` if you intentionally want to skip the first-screen admin creation flow.

Optionally edit non-secret vars in `wrangler.jsonc`:

```jsonc
"vars": {
  "MANAGEMENT_HOST": "mail.example.com",
  "PASSWORD_RESET_FROM": "no-reply@example.com",
  "WORKER_SCRIPT_NAME": "emailfox"
}
```

If your API token can access multiple Cloudflare accounts, also add `CLOUDFLARE_ACCOUNT_ID` as a non-secret Worker var in your private installed copy.

Build, apply remote migrations, and deploy:

```bash
npm run deploy
```

## Local Development

Create `.dev.vars` only if you need local-only advanced values:

```bash
touch .dev.vars
```

Edit `.dev.vars` only if you want local Cloudflare automation. Add the optional Cloudflare API token manually when needed.

```dotenv
# optional Cloudflare automation token goes here
```

Optional local-only values:

```dotenv
PASSWORD_RESET_FROM=no-reply@example.com
ADMIN_PASSWORD_BOOTSTRAP=
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
  -H "Authorization: Bearer $EMAILFOX_PASSWORD" \
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
| Raw mail/attachments | Cloudflare R2 |
| Admin auth | D1-stored salted PBKDF2 password hash |

## Security Notes

- Do not commit `.dev.vars`.
- Do not commit real API tokens or admin passwords.
- Use least-privilege Cloudflare API tokens.
- Leave `ADMIN_PASSWORD_BOOTSTRAP` blank unless you intentionally use the legacy bootstrap path.
- Password reset tokens are stored hashed in D1 and expire after 30 minutes.
- Emailfox only sends from enabled D1 mailbox addresses on verified sending domains.
- `sessionStorage` is used for the admin password in the browser session. For a larger public SaaS deployment, consider replacing this with HttpOnly session cookies and CSRF protection.
- The default public template has no custom domain, account id, D1 id, or personal domain baked into source control.

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

- Confirm `wrangler.jsonc` does not contain your personal account id, D1 id, or custom domain.
- Confirm `.dev.vars` is not tracked.
- Confirm docs/screenshots do not show private domains or real emails.
- Confirm `README.md` deploy button points to the public repository URL.
- Run `npm audit --audit-level=moderate`.
- Run `npm run build`.

## License

Choose and add a license before announcing the repository publicly. MIT is a common choice for small developer tools, but pick the license that matches how you want others to use Emailfox.
