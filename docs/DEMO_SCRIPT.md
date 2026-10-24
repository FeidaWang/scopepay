# ScopePay demo: 2 minutes 45 seconds

**Working title:** ScopePay — make the next request a clear agreement.

**Audience:** Freelancers and small creative studios handling client changes after an original scope has been agreed.

**One-sentence pitch:** ScopePay compares a new client request with the agreed scope, builds a quote from the studio's own rates, and connects the accepted change to a PayPal invoice and verified payment state.

## Prepare the recording

Complete `PAYPAL_SETUP.md` first. Use an actual runtime AI provider and PayPal sandbox for the submission recording. Keep the provider indicators visible at the start. Example mode is a demonstration walkthrough, not a substitute for working AI inference and PayPal integration.

For an Example-mode rehearsal, use the seeded **Juniper investor pitch** project. For the real sandbox recording, create a **new project** with the same agreement and your Personal sandbox buyer email. The current application does not edit an existing project's client email.

Use this brief when creating the new project:

> Create a 12-slide English pitch deck for Juniper Studio. The fixed project fee is A$600. Delivery is in English only; translated versions are not included. The scope includes one round of revisions to the existing slides, including title and wording changes. Additional slides are outside this agreement.

Set the base fee to A$600 and the revision allowance to one. Extract the scope, review it and confirm it before recording. Keep the rates at A$45 for an additional slide and A$180 for an additional language version. The base A$600 is a reference price only; the demo collects the additional work.

Preserve the workspace once a real sandbox invoice has been created. Sign in to the buyer's sandbox account in a separate browser profile before recording to keep the payment step short. Hide account credentials and unrelated tabs.

Paste this request during the demo:

> Could we add four slides for the financials, provide a Chinese version, and change the title on slide 1?

Expected quote after review: four additional slides at A$45 = A$180, plus one translated version at A$180 = **A$360**. The title change is within the agreed revision round and adds no charge. If the actual model asks a reasonable clarification, resolve it honestly; do not edit the video to imply the model produced an output it did not produce.

## Recording timeline

| Time | On screen | Suggested narration |
| --- | --- | --- |
| 0:00–0:15 | Project overview; actual AI and PayPal sandbox indicators | “A client asks for a few small changes. Some are included; others create real extra work. ScopePay helps a freelancer turn that conversation into a clear agreement and a payment.” |
| 0:15–0:35 | Confirmed scope and rate card | “Here is the agreement: twelve English slides, one revision round, and the studio's own prices for extra work. The original project fee is six hundred dollars. We are only billing the change.” |
| 0:35–1:05 | Paste the request, run real analysis, inspect the three results | “The AI compares each request with the agreed wording. Four new slides and a translated version are additional. The title change is included. Each decision shows the part of the agreement it relies on.” |
| 1:05–1:25 | Review line items and approve the A$360 quote | “The amount comes from the studio's rate card: one hundred and eighty dollars for the slides, plus one hundred and eighty for the translated version. That is three hundred and sixty dollars. I can correct the quote before approving it.” |
| 1:25–1:45 | Open the client review link and accept | “The client sees the exact change and amount. Their acceptance is recorded before the payment request is created.” |
| 1:45–2:15 | Create the real sandbox invoice; open PayPal and pay with the sandbox buyer | “ScopePay now creates an itemised PayPal sandbox invoice. The client pays through PayPal. This is a sandbox transaction, so no real money moves.” |
| 2:15–2:35 | Back in ScopePay; refresh if needed; show invoice ID and payment status | “The app checks PayPal's invoice state. A paid event alone is not enough: the balance and transaction evidence must agree. Here is the invoice and its confirmed paid amount.” |
| 2:35–2:45 | Final project view and history | “One request, one agreed change, one traceable payment. The freelancer stays in control, and the client knows what they are paying for.” |

Aim for 165 seconds. Rehearse twice. Capture the application's actual operation and PayPal checkout; avoid replacing any functional step with a static design or a staged success screen. If webhook delivery is delayed, show the real refresh action and say that it queries PayPal directly.

## What the demo proves

| Requirement | Evidence in the recording |
| --- | --- |
| Meaningful AI | A real model compares free-text requests with the confirmed agreement and returns individual classifications with evidence. |
| Meaningful PayPal | A real sandbox invoice is created, paid by the sandbox buyer and read back from PayPal. |
| Complete experience | Merchant review, client acceptance, payment and updated project history are shown together. |
| Human control | The merchant reviews the quote and the client accepts the amount before invoicing. |
| Reproducibility | The public repository includes source, dependency lockfile, licence, environment example, setup instructions and tests. |

The webhook verification implementation and duplicate-invoice recovery can be described in the README rather than spending scarce video time on source code.

## Keep the claims precise

- Describe this as a working prototype with a single sandbox merchant and AUD invoices.
- The original scope is entered or confirmed by the merchant. Do not claim the current version automatically extracts every contract or email attachment.
- The demo analyses change requests and invoices additional work. It does not demonstrate collecting the base project fee.
- ScopePay does not provide escrow, autonomous spending, tax advice or automatic dispute resolution.
- Example mode is labelled and separate. Never describe an example payment as a completed PayPal transaction.
- Do not claim hours saved, higher revenue or customer adoption without actual measurement.

## Submission notes

Use original narration and screen recordings. No background music is needed. Check that all visible material can be included in the submission and that the video meets the current event's rules. Upload a publicly visible video under three minutes and link the repository and functional demo or complete local setup instructions.

In the tools section, identify both the **development assistants** used to build the project and the **runtime model** shown in the final demonstration. State the runtime model's actual provider and identifier after configuring it; do not present a placeholder or Example mode as a real model.
