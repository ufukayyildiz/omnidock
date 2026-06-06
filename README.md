# EmailFox

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/OWNER/REPO)

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
- Choose between five UI palettes: Mint, Ubuntu, Fedora, Plasma, Graphite

Emailfox is not an IMAP/POP3 server and does not replace a full mailbox provider. It is best for private support inboxes, project inboxes, catch-all workflows, and lightweight multi-domain email operations that already live on Cloudflare.

## One-Click Deploy

Click the button at the top of this README and follow Cloudflare's setup flow.

Cloudflare's Deploy to Cloudflare flow will:

1. Clone this public repository into your own GitHub or GitLab account.
2. Let you choose the new repository name, Worker name, and resource names.
3. Provision supported resources from `wrangler.jsonc`, including D1 and R2.
4. Run the configured build/deploy command.
5. Configure Workers Builds so future pushes can deploy automatically.

This is not a normal GitHub fork requirement. Cloudflare creates a new repository copy in the deployer's Git provider account during the deploy flow.

If you move this project to another GitHub organization or repository name, update the button URL:

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/YOUR_ORG/YOUR_REPO)
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
- Password

The password is stored only as a salted PBKDF2 hash in D1.

`ADMIN_PASSWORD_BOOTSTRAP` is optional and exists only for legacy or automated installs. Normal public deploys can leave it blank.

### Cloudflare API Token

Create a Cloudflare API token for `CLOUDFLARE_API_TOKEN`.

Recommended permissions:

- Account > Account > Read
- Account > Email Sending > Read
- Zone > Zone > Read
- Zone > Email Routing > Read
- Zone > Email Routing > Edit
- Account > Workers Scripts > Read

If your token can access exactly one Cloudflare account, leave `CLOUDFLARE_ACCOUNT_ID` blank. If it can access multiple accounts, set `CLOUDFLARE_ACCOUNT_ID` to the account id you want Emailfox to use.

## Deploy Flow Inputs

During one-click deploy, Cloudflare reads:

- `wrangler.jsonc` for Worker, D1, R2, assets, and env vars
- `.dev.vars.example` for required secrets
- `package.json` scripts and Cloudflare binding descriptions

You will be asked to configure:

| Value | Required | Notes |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Yes | Used for Cloudflare sync and routing rule creation. |
| `ADMIN_PASSWORD_BOOTSTRAP` | No | Legacy/automation fallback. Leave blank for normal first-screen admin creation. |
| `MANAGEMENT_HOST` | No | Leave blank for the generated `workers.dev` host. Set later for a custom domain. |
| `CLOUDFLARE_ACCOUNT_ID` | No | Leave blank unless the API token can access multiple accounts. |
| `PASSWORD_RESET_FROM` | No | Verified sender for password reset emails. If blank, Emailfox uses the admin email. |
| D1 database name | Yes | Default is `emailfox-db`; Cloudflare can provision it. |
| R2 bucket name | Yes | Cloudflare can provision it during deploy. |

Every deployer must provide their own secrets in Cloudflare during setup. Do not put real values in `wrangler.jsonc`, README files, screenshots, issues, or commits.

Use Cloudflare secrets for:

- `CLOUDFLARE_API_TOKEN`
- `ADMIN_PASSWORD_BOOTSTRAP`, only if you intentionally use the legacy bootstrap path

Use plain Worker vars only for non-secret values:

- `MANAGEMENT_HOST`
- `CLOUDFLARE_ACCOUNT_ID`
- `PASSWORD_RESET_FROM`
- `WORKER_SCRIPT_NAME`

`database_id` is not a Worker secret. Wrangler needs it as D1 binding configuration for remote deploy/migration commands. For the public template, leave it out so one-click deploy can provision the deployer's own D1 database. For a private/manual deployment, add the deployer's own `database_id` locally or through the deploy platform configuration, never as a committed personal value.

The deploy script runs:

```bash
npm run build && wrangler deploy && npm run db:migrate:remote
```

The first `wrangler deploy` call lets Cloudflare provision missing D1/R2 resources. D1 migrations then use the binding name `DB`, which is important for one-click deploy because users may rename the actual D1 database.

If the Cloudflare setup screen asks for commands, use:

- Build command: `npm run build`
- Deploy command: `npm run deploy`

## First Login

After deploy:

1. Open the Worker URL shown by Cloudflare.
2. Enter the `ADMIN_PASSWORD_BOOTSTRAP` value.
3. Emailfox creates the D1 password hash.
4. Click `Sync Cloudflare`.
5. Select a domain.
6. Create mailboxes such as `support`, `info`, or `billing`.
7. Use `Settings > Rules` to route addresses to the Worker.

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

Set secrets:

```bash
npx wrangler secret put CLOUDFLARE_API_TOKEN
```

Only set `ADMIN_PASSWORD_BOOTSTRAP` if you intentionally want to skip the first-screen admin creation flow.

Optionally edit non-secret vars in `wrangler.jsonc`:

```jsonc
"vars": {
  "MANAGEMENT_HOST": "mail.example.com",
  "CLOUDFLARE_ACCOUNT_ID": "your-account-id",
  "PASSWORD_RESET_FROM": "no-reply@example.com",
  "WORKER_SCRIPT_NAME": "emailfox"
}
```

Apply migrations:

```bash
npm run db:migrate:remote
```

Deploy:

```bash
npm run deploy
```

## Local Development

Create `.dev.vars` from the example:

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars`:

```dotenv
CLOUDFLARE_API_TOKEN=replace-with-a-cloudflare-api-token
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
