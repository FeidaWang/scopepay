# Deployment

## Supported deployment shape

Run one Node.js 24+ process with a persistent local disk and HTTPS. The included Dockerfile is portable to container hosts. Build using `npm ci && npm run build`; start using `npm start`. Set `PORT`, `DATABASE_PATH` and `APP_URL` for the host. Health endpoint: `/api/health`.

SQLite persistence depends on the disk. A host that discards the filesystem on restart will discard workspaces, review links and invoice references. Use a persistent volume for `/app/data`, and include it in a backup policy. Do not run multiple replicas against separate SQLite files.

## Provider configuration

Store private keys in the host's secret/environment settings. Do not commit `.env`. Restart the service after changing providers. Configure an actual AI model and PayPal sandbox before recording the connected demo.

Ollama running on your laptop is not reachable at `localhost` from a remote host. Use an appropriate reachable model service or run the model alongside the app. The AI adapter requires HTTPS for non-local OpenAI-compatible endpoints. A model running in Docker needs explicit networking; do not expose an unauthenticated model server to the internet.

## PayPal callbacks

Set `APP_URL=https://your-demo-host.example` and register `https://your-demo-host.example/api/paypal/webhook` on the same sandbox app whose credentials the server uses. Copy the resulting webhook ID into `PAYPAL_WEBHOOK_ID`. Use an actual sandbox buyer, and perform a payment through the returned PayPal invoice URL. Refresh and webhook paths both reconcile the actual invoice details.

## Hosting and competition access

No deployment is created automatically by this repository. Render is one compatible option; its hackathon page advertises hosting credits, but the operator must confirm their own credit balance, expiry and the cost of persistent storage. This repository does not activate a paid plan.

Keep the chosen hosting, model and component access available for the complete judging period. For this event the published judging end is 15 December 2026 at 08:00 Pacific Time, or 16 December at 03:00 in Melbourne. Confirm the [official rules](https://paypalaihackathon.devpost.com/rules) before submission.

## Before sharing the demo

Verify the live model response, client acceptance, sandbox buyer payment, refreshed invoice state and a real verified webhook. Provide judges with a clear starting scenario and dedicated sandbox access. Keep provider secrets out of public instructions. If the hosting provider has request logs, redact review tokens and avoid logging bodies or payment credentials.
