# Architecture and decision record

## User story

A merchant confirms a project scope, reviews an AI assessment of a client change, prepares a quote, obtains client acceptance and creates a PayPal sandbox invoice. Verified payment data returns to the same versioned quote.

## State and authority

| Record | States | Authoritative source |
| --- | --- | --- |
| Project scope | draft → confirmed; editing creates another draft version | Merchant confirmation |
| Analysis item | included / additional / clarify | Model proposal followed by merchant review |
| Quote | draft → approved → accepted → invoiced | Server workflow; acceptance through private client link |
| Invoice | unpaid / partially_paid / pending / paid / cancelled | PayPal API, or explicitly marked example simulation |

Quote totals are computed by the server from validated integer-cent prices and integer quantities. A client-supplied total is never accepted. A quote line references an assessment item by ID. Only additional work may be charged. Unresolved questions must be reviewed first. After merchant approval, line items are immutable. A newer scope version invalidates acceptance and invoicing of an older quote.

The original fee is reference context. This implementation creates supplemental change invoices; it does not imply that the original fee has been paid.

## Persistence and concurrency

SQLite stores a workspace document and indexes for client review links, external invoice IDs, webhook event IDs, invoice operations and request usage. Mutations are serialised per workspace, including asynchronous model and payment requests. The deployment is intentionally a single Node process. Multiple replicas would require a shared database, transactional row locks and a durable job queue.

An invoice operation reserves a stable `SP-…` invoice number before contacting PayPal. A repeated request for an already recorded quote returns the same invoice. If an upstream outcome is unclear, the adapter searches for the exact invoice number and compares its merchant, recipient, currency and amount before recovery. It never silently creates a differently numbered invoice. Webhooks that arrive before local registration are harmless: the subsequent read or manual refresh reconciles the current state.

## Request allowances

| Operation | Workspace allowance | Shared deployment allowance |
| --- | --- | --- |
| Scope extraction and change analysis | 30 attempts per rolling hour, including Example mode | 100 live model attempts per rolling 24 hours, across all workspaces |
| Invoice creation or recovery | 10 attempts per rolling hour, including Example mode | 50 PayPal sandbox invoice attempts per rolling 24 hours, across all workspaces |

Live model limits apply to both Ollama and the compatible model adapter. The shared limits use a global key in SQLite, so creating another browser workspace does not reset them. Usage records survive application restarts and are retained for seven days; consuming an hourly allowance does not delete records still needed by the 24-hour allowance. These are rolling windows, not midnight resets.

Allowances count admitted attempts rather than successful results, tokens or monetary cost. A failed provider request can consume an allowance. Returning an invoice already stored for a quote does not create another invoice attempt. Existing invoice refreshes and verified webhook reconciliation are separate from the creation allowance.

## AI boundary

`extractScope` and `analyseChange` are the only model operations. Inputs are bounded and quoted as untrusted data. Results use a structured schema. Evidence must be verbatim source text; linked scope/rate IDs must exist. Unsupported references become clarification items. The server cannot mechanically prove every semantic claim, so merchants must review the output. Credentials and payment execution are not model tools.

Example mode uses transparent deterministic rules and is labelled as such throughout the interface. A live model failure is an error, never an automatic switch to simulated output.

## Access boundary

The prototype gives each browser a random HttpOnly, SameSite session cookie. CSRF tokens and same-origin checks protect merchant writes. A client review link contains a random 256-bit token and returns only the relevant quote and minimal project information. It does not expose the merchant workspace or client email. Reset revokes example review links. Workspaces containing PayPal invoice records cannot be reset through the demo button.

This access model supports a judge demonstration. A production product needs authenticated merchants, explicit invitations, expiry and revocation controls, recovery, backups, retention policy and per-merchant PayPal onboarding.

## Payment boundary

The PayPal API base is fixed to sandbox. The merchant's OAuth credentials stay on the server. The app sends no invoice email notifications; the merchant shares the hosted invoice link. Link hosts are checked before returning them to the browser.

A webhook is a notification, not final proof of full payment. After successful signature verification, the application reads the invoice, checks ID, currency and amount, and records the current payment state. The invoice adapter does not treat manually recorded external payments as a settled PayPal payment.

## API summary

| Route | Purpose |
| --- | --- |
| `GET /api/bootstrap` | Session workspace, provider status and CSRF token |
| `POST /api/projects` | Create a draft project |
| `POST /api/projects/:id/scope/extract` | Prepare scope using configured model |
| `PATCH /api/projects/:id/scope` | Save a new draft scope version |
| `POST /api/projects/:id/scope/confirm` | Confirm the scope |
| `POST /api/projects/:id/analyses` | Assess a change request |
| `PATCH /api/analyses/:id` | Save explicit merchant review decisions |
| `POST /api/projects/:id/quotes` | Create a validated quote |
| `PATCH /api/quotes/:id` | Edit a draft quote |
| `POST /api/quotes/:id/approve` | Fix the quote and create a client link |
| `GET /api/review/:token` | Read the public client review |
| `POST /api/review/:token/accept` | Accept the fixed quote |
| `POST /api/quotes/:id/invoice` | Create or recover the invoice |
| `POST /api/invoices/:id/refresh` | Read the current payment state |
| `POST /api/paypal/webhook` | Verify and reconcile PayPal notifications |
| `POST /api/invoices/:id/example-payment` | Simulate an example invoice only |

All merchant writes require `X-CSRF-Token`. Public review acceptance is protected by the high-entropy review capability and same-origin checks. The webhook uses PayPal signature verification.
