# OmniDock GitHub SEO Checklist

Use this file when publishing OmniDock as a public GitHub repository. GitHub repository search is driven mostly by the README, repository description, topics, stars, links, releases, and issue/discussion activity. The repository itself cannot create GitHub topics automatically, so set the fields below manually after publishing.

## Repository About Box

Description:

```text
Open-source Cloudflare email dashboard with Email Routing, Email Sending, D1, R2 bucket management, PDF preview, indexed R2 search, Gmail sync, external IMAP/SMTP, contacts, signatures, logs, and Workers AI document indexing.
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
r2-file-manager
r2-bucket-manager
r2-storage
cloudflare-storage
workers-ai
file-preview
attachment-storage
email-dashboard
support-inbox
self-hosted-email
email-routing
email-sending
d1-database
gmail-sync
external-email
external-imap
external-smtp
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

## Primary Positioning

OmniDock should be positioned as three products working together:

| Pillar | Search language | Why it matters |
| --- | --- | --- |
| Cloudflare email dashboard | Cloudflare Workers email app, Email Routing UI, Email Sending dashboard, support inbox | Captures the core inbox and routing audience |
| R2 file manager | R2 bucket manager, R2 file manager, PDF preview, document search, R2 text index | Differentiates OmniDock from a simple mailbox UI |
| External email operations | Gmail sync, external IMAP/SMTP, SMTP sending, resumable IMAP sync | Captures teams that need provider inboxes next to Cloudflare mail |

Recommended one-line pitch:

```text
OmniDock is a self-hosted Cloudflare email and R2 operations console for support inboxes, routing, sending, bucket management, indexed document search, Gmail sync, and external IMAP/SMTP accounts.
```

Recommended short GitHub description if space is tight:

```text
Self-hosted Cloudflare email and R2 dashboard with Email Routing, Email Sending, D1, R2 file manager, PDF preview, Gmail sync, and external IMAP/SMTP.
```

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
- R2 folder browser
- R2 object preview
- Cloudflare R2 PDF preview
- Cloudflare R2 document search
- PDF preview
- attachment preview
- Workers AI OCR/document indexing
- D1-backed R2 text search
- D1 email database
- R2 attachment storage
- Gmail sync
- external IMAP sync
- external SMTP sending
- resumable external inbox sync
- Worker-secret credential references

## Keyword Clusters

Use these clusters across the README, GitHub Pages copy, release notes, and issue titles. The goal is natural repetition, not stuffing.

### R2 Cluster

- Cloudflare R2 bucket manager
- R2 file manager for Cloudflare Workers
- R2 upload and download workflow
- R2 object browser
- R2 folder browser
- R2 attachment storage
- R2 PDF preview
- R2 image preview
- R2 text file preview
- D1-backed R2 text search
- searchable R2 documents
- Workers AI document indexing
- OCR-ready R2 indexes
- indexed R2 search

### External Email Cluster

- Gmail sync for Cloudflare Workers
- external IMAP sync
- external SMTP sending
- Gmail IMAP dashboard
- custom IMAP/SMTP accounts
- Outlook IMAP sync
- Yahoo IMAP sync
- iCloud email sync
- resumable mailbox sync
- D1-backed sync cursors
- Worker-secret email credentials
- self-hosted external email accounts

### Cloudflare Email Cluster

- Cloudflare email dashboard
- Cloudflare Workers email app
- Cloudflare Email Routing UI
- Cloudflare Email Sending dashboard
- support inbox on Cloudflare
- self-hosted support inbox
- multi-domain email routing
- catch-all email routing
- D1 email database
- serverless email dashboard

## README Layout Checklist

The top of the README should quickly show that OmniDock is real, visual, and useful:

- Badges for Workers, D1, R2, React, TypeScript, license, R2 bucket manager, PDF preview, indexed document search, external IMAP/SMTP, and fork-first safety.
- One real app screenshot near the top, captured with public-safe demo data.
- A compact "At A Glance" table.
- Separate R2 and External Email sections before the full install guide.
- A rendered Mermaid architecture diagram that mentions Email Routing, Email Sending, Workers, D1, R2, Index Engine, External IMAP/SMTP, and the OmniDock UI.
- Screenshot gallery covering Mail, R2 Buckets, Rules, Contacts, Signatures, External, Logs, Index Engine, Notes, and Other Settings.

## R2 Copy Blocks

Use these snippets in launch posts, release notes, and README sections.

Short:

```text
OmniDock includes a Cloudflare R2 bucket manager with folder browsing, upload/download actions, object deletes, PDF/image/text previews, path search, and D1-backed indexed document search.
```

Medium:

```text
The Buckets workspace turns R2 into an operator-friendly file console. Teams can browse prefixes, create folders, upload files, preview PDFs and text, download or delete objects, search filenames and paths, and use Index Engine to store searchable object text in D1.
```

Long:

```text
OmniDock goes beyond storing email attachments in R2. It exposes configured buckets as a real file manager, supports extra R2 buckets through `OMNIDOCK_EXTRA_R2_BUCKETS`, previews common file types in the dashboard, writes upload and delete actions to Logs, and can build D1-backed text indexes for PDFs, text files, and Workers AI-supported document conversion.
```

## External Email Copy Blocks

Short:

```text
OmniDock connects Gmail, Outlook, Yahoo, iCloud, and custom IMAP/SMTP accounts while keeping provider credentials in Cloudflare Worker secrets.
```

Medium:

```text
External accounts bring provider mailboxes into the same Cloudflare-hosted workspace. OmniDock stores only metadata and secret references in D1, uses Worker secrets for credentials, and keeps resumable IMAP sync cursors so long pulls can continue across scheduled runs.
```

Long:

```text
Use OmniDock when a team has Cloudflare-managed domain mail but still needs Gmail, Outlook, Yahoo, iCloud, or custom provider inboxes in the same operations console. Accounts can sync inbound mail through IMAP, send through SMTP, run as D1-backed resumable jobs, and stay safe for public forks because real credential values never belong in source control.
```

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
- Add examples for extra R2 buckets with `OMNIDOCK_EXTRA_R2_BUCKETS`.
- Add a troubleshooting guide for external IMAP cursors and scheduled sync jobs.
- Add a short demo video for R2 PDF preview and indexed object search.

## Release Titles

Use release names that include the product and the main searchable capability.

Examples:

- `OmniDock v0.1.0 - Cloudflare Workers email dashboard`
- `OmniDock v0.2.0 - Gmail sync and R2 bucket manager`
- `OmniDock v0.3.0 - Cloudflare Email Routing automation`
- `OmniDock v0.4.0 - External IMAP/SMTP accounts and OCR-ready R2 search`
- `OmniDock v0.5.0 - R2 file manager with PDF preview`
- `OmniDock v0.6.0 - Resumable Gmail and external IMAP sync`
- `OmniDock v0.7.0 - Indexed R2 document search on D1`

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
OmniDock gives teams a self-hosted support inbox, multi-domain routing dashboard, R2 file manager, external email sync, contacts, signatures, logs, and indexed document search without leaving the Cloudflare platform.
```

Feature paragraph:

```text
Use OmniDock to connect Cloudflare-managed mailboxes, Gmail, Outlook, Yahoo, iCloud, or custom IMAP/SMTP accounts; browse and control R2 buckets; preview PDFs, images, text files, and attachments; upload and delete objects; search paths, PDF text, and saved OCR text indexes; and keep audit logs in D1.
```

R2 and OCR paragraph:

```text
OmniDock includes an R2 bucket manager for Cloudflare Workers. It supports folder browsing, PDF/image/text preview, upload progress, downloads, deletes, path search, text/PDF search, D1-backed text indexes, and OCR-ready document extraction when a Workers AI binding is connected.
```

External email paragraph:

```text
OmniDock can connect Gmail, Outlook, Yahoo, iCloud, and custom external email accounts through IMAP and SMTP profiles. Credentials stay in Cloudflare Worker secrets while mailbox metadata, account status, and resumable sync cursors live in D1.
```

Call to action:

```text
Fork on GitHub
```
