# Verification record

**Date:** 24 October 2026

**Runtime:** Node.js v24.22.1

**Application mode for browser verification:** Example analysis and example payments.

The local automated checks and the browser workflow below passed. No actual LLM inference, PayPal API transaction or sandbox buyer payment was executed during these checks. The provider adapters were exercised with mocked HTTP responses.

## Automated checks

| Check | Result | What the result establishes |
| --- | --- | --- |
| `npm run typecheck` | Passed | The checked TypeScript application, shared types and tests compile without type errors. |
| `npm test` | Passed: 62 tests across 5 test files | The tested application workflow, domain rules, usage limits and provider behaviours match their assertions. |
| `npm run build` | Passed | The frontend and backend production outputs build successfully. |

The test suite covers the quote arithmetic and validation, example workflow, client acceptance, access boundaries, stale quotes, usage limits, structured model responses, source evidence, PayPal invoice recovery, payment-state interpretation and webhook verification implemented in this repository.

**Provider-test boundary:** Model and PayPal tests replace HTTP responses with controlled fixtures. They check adapter behaviour, including error and recovery paths. They do not verify credentials, model availability, real model output quality, a PayPal developer account, network reachability or delivery of a real webhook.

## Browser-verified example workflow

The following sequence was completed interactively in the local running application:

| Step | Observed result |
| --- | --- |
| Open the seeded Juniper project and analyse the sample request | Four additional slides and a language version were priced at A$180 each; the title change was included. |
| Review the decisions and create the quote | The additional-work quote total was A$360. The A$600 base fee remained reference context. |
| Approve the quote | A client review link was created. |
| Open the client review and accept the agreement | Acceptance was recorded, and the merchant view showed it after refresh. |
| Create the example invoice | An invoice for the accepted A$360 change was created. |
| Simulate a partial payment | The invoice recorded A$180 paid and A$180 remaining. |
| Simulate full payment | The invoice recorded A$360 paid and no remaining balance. |
| Refresh the client review | The client view reflected the updated invoice and payment state. |
| Create a fresh project, load its sample scope and confirm it | The draft became a confirmed scope and enabled change analysis. |
| Reload the application | Both projects and the A$360 simulated payment remained available in the workspace. |

The interface identified the analysis as sample output and the payments as simulations. These steps verify the interactive Example-mode flow; they are not PayPal transactions or evidence of live AI inference.

### Captured interface

- [Merchant overview](screenshots/overview-20261024.svg)
- [Client review](screenshots/client-review-20261024.svg)

## Not established by this verification

- A live Ollama or compatible hosted model response.
- PayPal OAuth using the operator's credentials, a real sandbox invoice and buyer payment, or a delivered and verified PayPal webhook.
- A production-money transaction; this prototype supports sandbox payments only.
- A hosted deployment, Docker deployment or continuing availability for judges.
- A 390-pixel mobile viewport test, a physical mobile device test or a full accessibility audit. Responsive styles and keyboard controls are implemented, but implementation alone does not establish that these checks passed.
- Every manual scope-editing variant; the browser run covered project creation, scope extraction and confirmation.

Follow [PayPal setup](PAYPAL_SETUP.md) and the [demo script](DEMO_SCRIPT.md) to verify the connected build before recording or submitting a demonstration that claims working AI and PayPal integration. Record the actual model identifier and observed sandbox invoice/payment references when that verification is completed; keep private credentials out of this document.
