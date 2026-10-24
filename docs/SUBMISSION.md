# Devpost submission draft

**Status:** Draft. Update this document after the connected AI and PayPal demonstration has been verified. Do not claim a hosted URL, user research, measured time savings, production transactions or sponsor integration unless you have completed them.

## Project name

ScopePay

## Tagline

Turn client changes into clear agreements and PayPal payments.

## Inspiration

A small request can mean a different project. Freelancers and clients need a clear way to see what changed, understand the extra work and agree on the price. We wanted the reasoning and the payment to stay connected.

## What it does

ScopePay compares a new client request with a confirmed project scope. It presents included work, additional work and unresolved questions alongside the relevant source text. The merchant reviews the assessment, edits a change quote and shares a private review link. After the client accepts, ScopePay creates a PayPal sandbox invoice and reconciles its payment state.

## How we built it

The application uses React, TypeScript, Vite, Express and Node's SQLite support. A configurable AI adapter supports local Ollama or a compatible hosted model with structured output. The PayPal integration uses Invoicing v2, OAuth and verified webhooks. Money calculations and workflow transitions run in deterministic server code.

## Why AI and PayPal matter

AI handles the ambiguous natural-language comparison between a client message and an existing agreement. PayPal supplies the actual sandbox invoice and payment flow. ScopePay connects the model's proposed interpretation, the merchant's decision, the client's acceptance and the resulting payment record.

## What is distinctive

The focus is on evidence and change versions: every proposed charge has an assessment item, a visible basis, an approved quote and a payment reference. Questions requiring clarification are resolved before a quote is created.

## Current implementation limits

AUD only; one sandbox merchant; supplemental change invoices. Example mode is a clearly labelled rule-based and simulated walkthrough. Connected mode requires a real configured model and PayPal sandbox credentials. The product does not hold funds in escrow, charge buyers automatically or onboard third-party sellers.

## Tools disclosure

- ChatGPT/Codex: assisted architecture, implementation, code review and test development.
- Runtime AI provider/model: **fill in the provider and exact model actually used in the recorded build**.
- PayPal: sandbox Invoicing v2, OAuth, payment status reads and webhook verification.
- Hosting: **fill in the host actually used, or specify local setup instructions**.
- Sponsor tools: **list only tools meaningfully used in the project**.

## Submission links

- Source: https://github.com/FeidaWang/scopepay
- Functional demo: **add a verified hosted URL, or use the complete README setup instructions**.
- Video: **record and upload a publicly visible YouTube video shorter than three minutes**.

## Remaining submission work

1. Configure and verify the selected runtime model.
2. Configure sandbox seller/buyer accounts and verify the full payment and callback flow.
3. Confirm judge access and keep it available through the judging period.
4. Record the demonstration using `DEMO_SCRIPT.md`, replace placeholders and submit on Devpost.

The repository alone is not a submitted Devpost entry. The video and connected demonstration remain explicit completion gates.
