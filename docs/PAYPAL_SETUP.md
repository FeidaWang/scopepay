# PayPal sandbox setup

ScopePay connects one sandbox merchant to one sandbox buyer through PayPal Invoicing v2. The application uses Australian dollars and creates an invoice only after the merchant approves a change quote and the client accepts it.

The HTTP API host is fixed in `server/paypal.ts` to `https://api-m.sandbox.paypal.com`. There is no production payment mode or configurable payment host. Sandbox transactions do not move real money.

## What has and has not been verified

The repository includes the PayPal API implementation and automated tests with mocked HTTP responses. Those tests cover authentication, invoice creation and recovery, payment status interpretation, webhook verification and sanitised errors. They do not establish that a particular developer account is ready to receive payments.

An end-to-end PayPal run requires your sandbox credentials and an actual sandbox buyer payment. A competition recording must show that run, with a real AI provider enabled. The default **Example mode** uses demonstration responses and simulated payment states; it is useful for reviewing the product but is not a substitute for the required PayPal + AI integration.

## 1. Prepare the two sandbox accounts

1. Sign in to the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/).
2. Open **Testing tools / Sandbox accounts**. PayPal normally creates a Business seller and a Personal buyer when a developer account is created. If needed, create these accounts in the dashboard.
3. Save the Personal buyer's sandbox email and password privately. The buyer and seller must be different accounts.
4. Open **Apps & Credentials**, select **Sandbox**, and create or select a REST application associated with the Business seller.
5. Copy that application's sandbox client ID and secret. Set the merchant email to the Business sandbox account associated with this application.
6. For this AUD-only prototype, use sandbox accounts that can transact in AUD. Check the buyer's sandbox balance/payment method and the seller's currency settings before recording.

These are test accounts. For a real sandbox run, create a **new project** and enter the Personal sandbox buyer email in its **Client email** field. The seeded example has a fictional email and can be used for Example mode; the current application does not edit an existing project's client email. No real client is needed.

Official reference: [Sandbox accounts](https://developer.paypal.com/sandbox-testing/accounts/).

## 2. Configure the application

From the project root, copy `.env.example` to `.env`, then edit the private file:

```dotenv
PAYMENT_PROVIDER=paypal-sandbox
PAYPAL_CLIENT_ID=your_sandbox_app_client_id
PAYPAL_CLIENT_SECRET=your_sandbox_app_client_secret
PAYPAL_MERCHANT_EMAIL=your_business_sandbox_email
PAYPAL_WEBHOOK_ID=your_registered_sandbox_webhook_id
PORT=3000
APP_URL=https://your-https-demo-host.example
```

The four PayPal values must be present before the application reports the sandbox integration as configured. `APP_URL` is the externally reachable URL used by the browser; for a strictly local run it can be `http://localhost:3000`, but webhook delivery requires an HTTPS endpoint.

Configure one actual AI provider separately, using the options in `.env.example` and the main README. The available runtime providers are `ollama` and `openai-compatible`. The latter needs a compatible model, base URL and API key when the provider requires one. Your coding-assistant subscription is used during development; it does not automatically configure the hosted application's AI runtime.

Keep `.env`, client secrets and buyer passwords out of source control and the video. The browser should only receive provider names and configuration status, never these credentials.

## 3. Register the webhook

1. Run the app behind an HTTPS deployment, or an HTTPS tunnel forwarding to local port 3000.
2. In the **same sandbox REST application's** configuration, add this webhook URL:

   ```text
   https://your-https-demo-host.example/api/paypal/webhook
   ```

3. Subscribe to the invoice events needed by the prototype:

   - `INVOICING.INVOICE.PAID`
   - `INVOICING.INVOICE.UPDATED`
   - `INVOICING.INVOICE.CANCELLED`
   - `INVOICING.INVOICE.REFUNDED`

4. Copy the registered webhook ID into `PAYPAL_WEBHOOK_ID`. This is the subscription's ID, not an event ID or an invoice ID.
5. Restart the application after changing its environment.

ScopePay sends the received PayPal headers, event and stored webhook ID to PayPal's sandbox `verify-webhook-signature` endpoint. A verified event prompts a fresh invoice lookup; the event's name does not directly set the invoice to paid. Failed signature checks are rejected. Network and upstream service failures remain errors so PayPal can retry delivery.

**Use a real sandbox transaction to test this route.** PayPal's webhook simulator produces mock events that do not support the postback verification endpoint used here. A simulator event being rejected is not evidence that the real payment flow is broken. See [Integrate webhooks](https://developer.paypal.com/api/rest/webhooks/rest/).

## 4. Run one complete payment

```bash
npm ci
npm run dev
```

1. Open the app at your configured URL. Confirm that the runtime indicators identify an actual AI model and **PayPal sandbox**.
2. Create a new project with the Personal sandbox buyer email. Use the Juniper agreement below as its brief, set the base fee to A$600 and the revision allowance to one, then extract, review and confirm its scope. Keep the rates at A$45 per additional slide and A$180 per additional language version.
3. Enter the change request below, run analysis, and review the evidence and selected rates. Four additional slides cost A$180 and the translated version costs A$180, giving an A$360 quote. The title change is included in the agreed revision round.
4. Approve the resulting quote, open its client review link, and accept the change as the test client.
5. Return to the merchant view and create the invoice.
6. Follow the returned PayPal sandbox payment link. Sign in as the Personal sandbox buyer and complete the payment.
7. Return to ScopePay. Let the verified webhook update the invoice or use the payment refresh action to query PayPal directly.
8. Confirm the invoice ID, AUD total and paid amount in ScopePay against the seller's sandbox account.

Use this brief for the new sandbox project:

> Create a 12-slide English pitch deck for Juniper Studio. The fixed project fee is A$600. Delivery is in English only; translated versions are not included. The scope includes one round of revisions to the existing slides, including title and wording changes. Additional slides are outside this agreement.

Then use this change request:

> Could we add four slides for the financials, provide a Chinese version, and change the title on slide 1?

The A$600 base price is context, not an already-recorded payment. The current MVP invoices accepted **additional work**, totalling A$360 in this scenario. Do not present the base project fee as having been collected by this implementation.

## API flow and recovery

| Operation | PayPal API | Application behaviour |
| --- | --- | --- |
| Authenticate | `POST /v1/oauth2/token` | Caches a token only until shortly before its reported expiry. |
| Reconcile invoice number | `POST /v2/invoicing/search-invoices` | Searches the persisted number, then checks the exact match. |
| Create draft | `POST /v2/invoicing/invoices` | Uses accepted line items and integer-cent amounts, in AUD. |
| Enable payment | `POST /v2/invoicing/invoices/{id}/send` | Immediately sends the draft into the payable state with both email flags set to `false`. |
| Refresh | `GET /v2/invoicing/invoices/{id}` | Rechecks invoice state, total, due amount and PayPal transaction evidence. |
| Verify event | `POST /v1/notifications/verify-webhook-signature` | Verifies the real sandbox event before state updates. |

The word **send** is PayPal's API operation name. ScopePay sets `send_to_recipient: false` and `send_to_invoicer: false`, then uses the returned payer-facing link. It does not schedule invoices for a future issue date. The project creates a new invoice for each separately accepted quote; it does not update or reuse a different quote's payable invoice.

The parent application persists one invoice number per quote before calling PayPal. It is at most 25 characters. The same number is retained across failures. The adapter checks that an existing invoice's quote reference, recipient, currency and total match before reusing it.

If the draft creation response times out, the adapter searches for that number rather than immediately repeating the create request. If creation cannot be reconciled, it returns `PAYPAL_RECONCILIATION_REQUIRED`. If the draft exists but its send operation cannot be confirmed, it returns `PAYPAL_SEND_UNCONFIRMED` with the safe invoice ID. Retry the **same quote** to continue recovery. Do not reset the workspace, delete the operation record or generate a different invoice number to work around an uncertain result.

No rollback deletes or cancels a PayPal invoice after an uncertain response: the draft or payable invoice may already exist. Read the invoice in the sandbox dashboard if the uncertainty persists.

## Interpreting payment state

PayPal documents `INVOICING.INVOICE.PAID` as an event that can also accompany a partial or pending payment. ScopePay therefore reads the invoice after a verified event.

- **Paid:** fetched status is `PAID`, due amount is zero, and PayPal transaction evidence covers the invoice total.
- **Partially paid:** the invoice indicates partial payment or verified PayPal transactions cover only part of the total.
- **Pending:** PayPal reports a pending payment, or the invoice's status, balance and payment evidence do not establish settlement.
- **Unpaid:** the invoice is awaiting payment.
- **Cancelled:** PayPal reports a cancelled invoice.

External or manually recorded payments are not counted as proof of a PayPal settlement. Refund workflows are outside this prototype; refunded or manually adjusted states require review and are displayed conservatively as pending. ScopePay does not invoke the invoice record-payment or record-refund APIs to simulate settlement.

The adapter accepts payment links only on `sandbox.paypal.com` or `www.sandbox.paypal.com`, over HTTPS. A missing payment link remains missing; the app does not invent a checkout URL or convert an untrusted link into a live PayPal link.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Integration is not configured | All four PayPal environment values are present; `PAYMENT_PROVIDER` is exactly `paypal-sandbox`; the merchant email is valid. |
| Authentication fails | The client ID and secret belong to the Sandbox tab and the correct Business account. |
| Buyer cannot pay | Use a separate Personal sandbox account, check its credentials, balance and AUD support. |
| Invoice exists but no link appears | Refresh the invoice and inspect it in the sandbox dashboard. Do not substitute a live PayPal URL. |
| Webhook does not arrive | The HTTPS endpoint is reachable, the event is enabled, and the webhook belongs to the same REST app that created the invoice. |
| Webhook verification fails | The configured webhook ID matches the real subscription; the event is a real sandbox event, not a simulator mock. |
| State stays pending after payment | Inspect the fetched invoice's status, due amount and PayPal transactions. A pending review or manual payment does not meet the app's settlement checks. |
| Network error during creation | Keep the same quote and invoice number, then retry reconciliation. Inspect the seller's sandbox invoices if the result remains uncertain. |

## References

- [Create draft invoice](https://developer.paypal.com/api/invoicing/v2/invoices-create)
- [Send invoice and notification flags](https://developer.paypal.com/api/invoicing/v2/invoices-send)
- [Show invoice details](https://developer.paypal.com/api/invoicing/v2/invoices-get)
- [Search for invoices](https://developer.paypal.com/api/invoicing/v2/invoices-search-invoices)
- [Invoice payment transaction schema](https://developer.paypal.com/api/invoicing/v2/definitions/payments)
- [Invoice events, including partial and pending payments](https://developer.paypal.com/platforms/invoicing/customize/)
- [Idempotency support varies by API](https://developer.paypal.com/api/rest/reference/idempotency/)

Implementation references checked on 24 October 2026. Real-account sandbox validation must be completed with the operator's credentials before the submission is described as verified end to end.
