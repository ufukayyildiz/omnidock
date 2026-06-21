# OmniDock GitHub SEO Checklist

Use this file when publishing OmniDock as a public GitHub repository. GitHub repository search is driven mostly by the README, repository description, topics, stars, links, releases, and issue/discussion activity. The repository itself cannot create GitHub topics automatically, so set the fields below manually after publishing.

## Repository About Box

Description:

```text
Open-source Cloudflare email dashboard for Workers, Email Routing, Email Sending, D1, R2 bucket management, Workers AI document indexing, support inboxes, Gmail sync, external IMAP/SMTP, previews, uploads, contacts, signatures, logs, and indexed OCR search.
```

Website:

```text
https://omnidock.org
```

Topics:

```text
cloudflare
cloudflare-workers
cloudflare-email-routing
cloudflare-email-sending
cloudflare-d1
cloudflare-r2
workers-ai
email-dashboard
support-inbox
self-hosted-email
email-routing
email-sending
r2-storage
r2-bucket-manager
d1-database
gmail-sync
external-email
imap
smtp
pdf-preview
ocr-indexing
document-search
serverless
react
typescript
open-source
```

Social preview:

1. Export `docs/brand/omnidock-social-preview.svg` to PNG.
2. Upload the PNG in `Settings > Social preview`.
3. Keep the text readable at small sizes.

## Search-Friendly README Phrases

The README should naturally include these phrases without keyword stuffing:

- Cloudflare email dashboard
- Cloudflare Workers email app
- Cloudflare Email Routing UI
- Cloudflare Email Sending dashboard
- open-source support inbox
- self-hosted email management
- serverless email dashboard
- multi-domain email routing
- Gmail IMAP sync
- external IMAP/SMTP email accounts
- R2 file manager
- R2 bucket manager
- R2 upload and download workflow
- PDF preview
- attachment preview
- Workers AI OCR/document indexing
- D1-backed R2 text search
- D1 email database
- R2 attachment storage

## Launch Issue Ideas

Pinned or starter issues help GitHub understand project activity and help contributors find entry points.

Suggested labels:

- `good first issue`
- `help wanted`
- `documentation`
- `security`
- `cloudflare`
- `email`
- `r2`
- `external-accounts`

Suggested starter issues:

- Improve docs for a new Cloudflare Worker Git deployment.
- Keep real app screenshots updated for every primary module area.
- Add export/import tooling for OmniDock settings.
- Add optional OCR integration guide for searchable scanned PDFs.
- Add more IMAP provider presets.
- Keep demo screenshots for R2 upload progress, PDF preview, and Index Engine workflows.
- Add documentation for Gmail app password Worker secrets.

## Release Titles

Use release names that include the product and the main searchable capability.

Examples:

- `OmniDock v0.1.0 - Cloudflare Workers email dashboard`
- `OmniDock v0.2.0 - Gmail sync and R2 bucket manager`
- `OmniDock v0.3.0 - Cloudflare Email Routing automation`
- `OmniDock v0.4.0 - External IMAP/SMTP accounts and OCR-ready R2 search`

## Repository Quality Signals

Before asking for stars, make sure the repository has:

- A clear README first screen with screenshots.
- A real `SECURITY.md` policy.
- `CONTRIBUTING.md`, `SUPPORT.md`, and issue templates.
- A license file.
- Passing `npm run build`.
- No private Cloudflare account ids, D1 ids, bucket names, tokens, personal emails, or custom domains committed.
- A first tagged release.
- A short demo video or GIF linked near the top of the README when available.
- A GitHub Pages product page served from `docs/`, with `robots.txt`, `sitemap.xml`, screenshots, and Open Graph metadata.

## Website Copy

Hero headline:

```text
OmniDock
```

Hero subheading:

```text
Open-source email operations for Cloudflare Workers, Email Routing, Email Sending, D1, and R2.
```

Short paragraph:

```text
OmniDock gives teams a self-hosted support inbox, multi-domain routing dashboard, external email sync, contacts, signatures, logs, and R2 file management without leaving the Cloudflare platform.
```

Feature paragraph:

```text
Use OmniDock to connect Cloudflare-managed mailboxes, Gmail, Outlook, Yahoo, iCloud, or custom IMAP/SMTP accounts; browse and control R2 buckets; preview PDFs, images, text files, and attachments; upload and delete objects; search paths, PDF text, and saved OCR text indexes; and keep audit logs in D1.
```

R2 and OCR paragraph:

```text
OmniDock includes an R2 bucket manager for Cloudflare Workers. It supports folder browsing, file preview, upload progress, downloads, deletes, path search, text/PDF search, and OCR-ready text indexes for scanned PDFs or image files without automatic AI spend.
```

External email paragraph:

```text
OmniDock can connect Gmail and other external email accounts through IMAP and SMTP profiles. Credentials stay in Cloudflare Worker secrets while mailbox metadata and resumable sync cursors live in D1.
```

Call to action:

```text
Fork on GitHub
```
