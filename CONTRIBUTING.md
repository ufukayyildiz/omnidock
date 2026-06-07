# Contributing To OmniDock

Thanks for helping improve OmniDock, an open-source Cloudflare email dashboard for Workers, Email Routing, Email Sending, D1, R2, external inbox sync, contacts, signatures, logs, and R2 file management.

## Good First Contributions

- Improve setup docs for Cloudflare Git deploy.
- Add screenshots for UI palettes.
- Improve provider presets for external IMAP/SMTP accounts.
- Improve R2 object preview and search behavior.
- Add tests around security-sensitive parsing and validation.
- Improve accessibility, keyboard navigation, and responsive layout.

## Local Setup

```bash
npm install
npm run build
```

For local Worker development:

```bash
npm run dev:worker
npm run dev
```

Do not commit `.dev.vars`, Cloudflare tokens, admin passwords, app passwords, account ids, D1 database ids, R2 bucket names from private installs, personal emails, or custom management domains.

## Pull Request Checklist

Before opening a PR:

1. Keep changes focused.
2. Run `npm run build`.
3. Update README or docs when behavior changes.
4. Add screenshots for visible UI changes.
5. Check that no private deployment data is committed.
6. Explain security implications when touching auth, email sending, D1, R2, external accounts, or Cloudflare API automation.

## Code Style

- Use existing React and Worker patterns.
- Prefer typed helpers over ad-hoc parsing.
- Keep Cloudflare bindings and secrets out of source control.
- Use `ctx.waitUntil()` for post-response work in Workers.
- Avoid committing generated screenshots or reports unless they are documentation assets.

