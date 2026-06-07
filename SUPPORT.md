# Support

OmniDock is an open-source, self-hosted Cloudflare email operations dashboard. Community support works best when reports include deployment context without exposing secrets.

## Before Opening An Issue

Check:

- `README.md` install steps.
- `SECURITY.md` before sharing sensitive details.
- OmniDock Logs screen for the latest error or warning.
- Cloudflare Worker logs and deployment logs.
- Cloudflare D1 migrations.
- Cloudflare R2 bindings.
- Email Routing and Email Sending status for the affected domain.

## What To Include

- OmniDock commit or release.
- Deployment method: Cloudflare Git deploy, Wrangler deploy, or local dev.
- Affected feature: mail, routing, sending, external account sync, R2 bucket manager, contacts, signatures, logs, or setup.
- Safe error messages from OmniDock Logs.
- Screenshots with private emails/domains blurred if needed.

## Do Not Share

- Cloudflare API tokens
- Admin passwords
- Gmail or external app passwords
- OAuth secrets
- Full email contents
- Private account ids
- Private D1 database ids
- Private R2 bucket names when they identify infrastructure

For security issues, follow `SECURITY.md` instead of opening a public issue.

