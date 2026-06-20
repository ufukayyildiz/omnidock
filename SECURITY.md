# Security Policy

OmniDock is a self-hosted Cloudflare Workers application that can handle email content, attachments, contacts, external account metadata, and R2 objects. Treat every deployment as production infrastructure.

## Supported Versions

The public repository is pre-1.0. Security fixes are currently applied to the `main` branch.

| Version | Supported |
| --- | --- |
| `main` | Yes |
| Tagged pre-1.0 releases | Best effort |
| Private forks | Maintainer responsibility |

## Reporting A Vulnerability

Please do not open a public GitHub issue for vulnerabilities that expose credentials, email content, account ids, D1 data, R2 objects, routing rules, or authentication bypasses.

Preferred report:

1. Use GitHub private vulnerability reporting if it is enabled for the repository.
2. If private reporting is not enabled, open a minimal issue that says you have a security report without sharing exploit details.
3. Include affected version or commit, deployment mode, impact, reproduction steps, and whether secrets or user data may be exposed.

Expected response:

- Initial triage: best effort.
- Valid issue: fix on `main`, release notes when appropriate, and credit if requested.
- Invalid or out-of-scope issue: explanation when possible.

## Secret Handling

Never commit these values:

- Cloudflare API tokens
- Admin passwords
- Gmail or external mail app passwords
- OAuth secrets
- D1 database ids from private installs
- R2 bucket names from private installs when they identify private infrastructure
- Cloudflare account ids
- Personal email addresses or custom management domains
- `.dev.vars`

OmniDock stores external email credentials as Cloudflare Worker secrets. D1 stores the credential secret name, not the credential value.

## Security Model

- Admin authentication uses a D1-stored salted PBKDF2 password hash.
- Reset tokens are stored hashed and expire after 30 minutes.
- Cloudflare automation uses a Worker secret named `CLOUDFLARE_API_TOKEN`.
- Email sending is limited to enabled OmniDock mailbox addresses on verified sending domains or explicitly configured external SMTP accounts.
- R2 objects are served only through authenticated API routes.
- The browser does not store the admin password in web storage. Login creates a D1-backed admin session and returns an HttpOnly, SameSite cookie; only a hash of the session token is stored server-side.

For a multi-user SaaS deployment, replace the single-password model with user accounts, per-user authorization, tenant isolation, dedicated CSRF controls, and stronger distributed rate limiting.

## Deployment Safety

Use `node tools/deploy-preserving-bindings.mjs` or `npm run deploy` for Git deployments. A bare `npx wrangler deploy` can remove dashboard-only D1/R2 bindings.

Before making a fork public, run:

```bash
rg -n "api[_-]?token|password|secret|cloudflare_account_id|database_id|bucket_name|gmail|@" .
npm run build
```

Review the output manually before publishing.

Also keep local-only files out of Git. The repository `.gitignore` blocks common secret and credential file names such as `.env*`, `.dev.vars*`, private keys, certificates, and credential dumps, but manual review is still required before every public push.
