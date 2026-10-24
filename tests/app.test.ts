import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { Store } from '../server/store.js';
import type { Analysis, BootstrapResponse, ChangeQuote, QuoteLine } from '../shared/types.js';

describe('ScopePay application workflow', () => {
  let store: Store; let app: ReturnType<typeof createApp>['app']; let merchant: ReturnType<typeof request.agent>;
  let bootstrap: BootstrapResponse;
  beforeEach(async () => {
    process.env.AI_PROVIDER = 'example'; process.env.PAYMENT_PROVIDER = 'example'; delete process.env.APP_URL;
    store = new Store(':memory:'); app = createApp(store).app; merchant = request.agent(app);
    bootstrap = (await merchant.get('/api/bootstrap').expect(200)).body;
  });
  afterEach(() => store.close());
  const message = 'Please add four extra slides, a Chinese version, and change the title.';
  async function prepareQuote() {
    const project = bootstrap.workspace.projects[0];
    const analysed = await merchant.post(`/api/projects/${project.id}/analyses`).set('X-CSRF-Token', bootstrap.csrfToken).send({ message }).expect(200);
    const analysis: Analysis = analysed.body.analysis;
    const lines: QuoteLine[] = analysis.items.filter(i => i.classification === 'additional').map(i => ({ id: i.id, description: i.request, quantity: i.quantity, unitPriceCents: project.rateCard.find(r => r.id === i.rateId)!.unitPriceCents }));
    const made = await merchant.post(`/api/projects/${project.id}/quotes`).set('X-CSRF-Token', bootstrap.csrfToken).send({ analysisId: analysis.id, lines }).expect(200);
    return { project, analysis, quote: made.body.quote as ChangeQuote, lines };
  }
  it('isolates workspaces and rejects writes without CSRF or across origins', async () => {
    const other = await request(app).get('/api/bootstrap').expect(200);
    expect(other.body.workspace.projects[0].id).not.toBe(bootstrap.workspace.projects[0].id);
    await merchant.post('/api/reset').send({}).expect(403);
    await merchant.post('/api/reset').set('X-CSRF-Token', bootstrap.csrfToken).set('Origin', 'https://untrusted.example').send({}).expect(403);
    await request.agent(app).get(`/api/review/${'a'.repeat(43)}`).expect(404);
  });
  it('completes assessment, merchant approval, client acceptance and simulated payment', async () => {
    const { quote } = await prepareQuote();
    expect(quote.totalCents).toBe(36000);
    await merchant.post(`/api/quotes/${quote.id}/invoice`).set('X-CSRF-Token', bootstrap.csrfToken).send({}).expect(409);
    const approved = await merchant.post(`/api/quotes/${quote.id}/approve`).set('X-CSRF-Token', bootstrap.csrfToken).send({}).expect(200);
    const token = approved.body.quote.shareToken;
    const review = await request(app).get(`/api/review/${token}`).expect(200);
    expect(review.body.quote.shareToken).toBeUndefined();
    expect(review.body.project.clientEmail).toBeUndefined();
    await request(app).post(`/api/review/${token}/accept`).send({ accepted: true }).expect(200);
    const invoiced = await merchant.post(`/api/quotes/${quote.id}/invoice`).set('X-CSRF-Token', bootstrap.csrfToken).send({}).expect(200);
    expect(invoiced.body.invoice.provider).toBe('example');
    expect(invoiced.body.invoice.paymentUrl).toBeNull();
    const id = invoiced.body.invoice.id;
    const partial = await merchant.post(`/api/invoices/${id}/example-payment`).set('X-CSRF-Token', bootstrap.csrfToken).send({ outcome: 'partial' }).expect(200);
    expect(partial.body.invoice.status).toBe('partially_paid'); expect(partial.body.invoice.paidCents).toBe(18000);
    const paid = await merchant.post(`/api/invoices/${id}/example-payment`).set('X-CSRF-Token', bootstrap.csrfToken).send({ outcome: 'paid' }).expect(200);
    expect(paid.body.invoice.status).toBe('paid');
    const refreshed = await merchant.get('/api/bootstrap').expect(200);
    expect(refreshed.body.workspace.invoices[0].paidCents).toBe(36000);
    expect(refreshed.body.workspace.quotes[0].status).toBe('invoiced');
  });
  it('serialises simultaneous invoice requests and reuses the same invoice', async () => {
    const { quote } = await prepareQuote();
    const approved = await merchant.post(`/api/quotes/${quote.id}/approve`).set('X-CSRF-Token', bootstrap.csrfToken).send({}).expect(200);
    await request(app).post(`/api/review/${approved.body.quote.shareToken}/accept`).send({ accepted: true }).expect(200);
    const responses = await Promise.all(Array.from({ length: 3 }, () => merchant.post(`/api/quotes/${quote.id}/invoice`).set('X-CSRF-Token', bootstrap.csrfToken).send({}).expect(200)));
    expect(new Set(responses.map(r => r.body.invoice.id)).size).toBe(1);
    expect((await merchant.get('/api/bootstrap')).body.workspace.invoices).toHaveLength(1);
  });
  it('locks a shared quote, and rejects acceptance against an outdated scope', async () => {
    const { project, quote, lines } = await prepareQuote();
    const approved = await merchant.post(`/api/quotes/${quote.id}/approve`).set('X-CSRF-Token', bootstrap.csrfToken).send({}).expect(200);
    await merchant.patch(`/api/quotes/${quote.id}`).set('X-CSRF-Token', bootstrap.csrfToken).send({ lines: lines.map(l => ({ ...l, unitPriceCents: 1 })) }).expect(409);
    await merchant.patch(`/api/projects/${project.id}/scope`).set('X-CSRF-Token', bootstrap.csrfToken).send({ scope: project.scope, baseAmountCents: project.baseAmountCents, revisionAllowance: project.revisionAllowance }).expect(200);
    await request(app).post(`/api/review/${approved.body.quote.shareToken}/accept`).send({ accepted: true }).expect(409);
  });
  it('allows an explicit merchant assessment of an ambiguous request', async () => {
    const project = bootstrap.workspace.projects[0];
    const result = await merchant.post(`/api/projects/${project.id}/analyses`).set('X-CSRF-Token', bootstrap.csrfToken).send({ message: 'Please make the whole thing feel completely different.' }).expect(200);
    const analysis: Analysis = result.body.analysis;
    expect(analysis.items.some(i => i.classification === 'clarify')).toBe(true);
    const originalEvidence = analysis.items[0].evidence;
    const reviewed = await merchant.patch(`/api/analyses/${analysis.id}`).set('X-CSRF-Token', bootstrap.csrfToken).send({ items: analysis.items.map(i => ({ id: i.id, classification: 'additional', rateId: 'revision', quantity: 1, reason: 'Client confirmed an extra revision round.' })) }).expect(200);
    expect(reviewed.body.analysis.items[0].evidence).toBe(originalEvidence);
    expect(reviewed.body.analysis.items[0].reason).toContain('Merchant reviewed');
  });
  it('does not permit another visitor to mutate a merchant quote', async () => {
    const { quote } = await prepareQuote();
    const other = request.agent(app); const boot = await other.get('/api/bootstrap');
    await other.post(`/api/quotes/${quote.id}/approve`).set('X-CSRF-Token', boot.body.csrfToken).send({}).expect(404);
  });
  it('rejects another project’s analysis even when an existing quote could be reused', async () => {
    const { project, analysis, quote, lines } = await prepareQuote();
    const second = await merchant.post('/api/projects').set('X-CSRF-Token', bootstrap.csrfToken).send({
      title: 'Separate client project', clientName: 'Second Studio', clientEmail: 'second@example.com',
      brief: 'A separate project agreement.', baseAmountCents: 20_000, revisionAllowance: 1,
    }).expect(200);
    expect(second.body.project.id).not.toBe(project.id);
    await merchant.post(`/api/projects/${second.body.project.id}/quotes`).set('X-CSRF-Token', bootstrap.csrfToken)
      .send({ analysisId: analysis.id, lines }).expect(404);
    const original = await merchant.post(`/api/projects/${project.id}/quotes`).set('X-CSRF-Token', bootstrap.csrfToken)
      .send({ analysisId: analysis.id, lines }).expect(200);
    expect(original.body.quote.id).toBe(quote.id);
    expect(original.body.workspace.quotes).toHaveLength(1);
  });
  it('returns a client error for malformed JSON', async () => {
    const result = await merchant.post('/api/reset').set('X-CSRF-Token', bootstrap.csrfToken)
      .set('Content-Type', 'application/json').send('{"broken":').expect(400);
    expect(result.body.error.code).toBe('INVALID_JSON');
  });
  it('rejects change requests over 5,000 characters before consuming an analysis allowance', async () => {
    const project = bootstrap.workspace.projects[0];
    const result = await merchant.post(`/api/projects/${project.id}/analyses`).set('X-CSRF-Token', bootstrap.csrfToken)
      .send({ message: 'x'.repeat(5_001) }).expect(400);
    expect(result.body.error.code).toBe('INVALID_INPUT');
    expect(result.body.error.fields).toContain('message');
    const usage = store.db.prepare('SELECT COUNT(*) AS count FROM usage').get() as { count: number };
    expect(usage.count).toBe(0);
    expect((await merchant.get('/api/bootstrap')).body.workspace.analyses).toHaveLength(0);
  });
  it('clears local review links when resetting an example workspace', async () => {
    const { quote } = await prepareQuote();
    const approved = await merchant.post(`/api/quotes/${quote.id}/approve`).set('X-CSRF-Token', bootstrap.csrfToken).send({}).expect(200);
    await merchant.post('/api/reset').set('X-CSRF-Token', bootstrap.csrfToken).send({}).expect(200);
    await request(app).get(`/api/review/${approved.body.quote.shareToken}`).expect(404);
  });
});
