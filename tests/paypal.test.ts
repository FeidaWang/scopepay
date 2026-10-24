import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangeQuote, Project } from '../shared/types.js';

const invoiceId = 'INV2-ABCD-EFGH-IJKL-MNOP';
const invoiceNumber = 'SP-quote123';
const sandboxLink = 'https://www.sandbox.paypal.com/invoice/p/#ABCDEFGHIJKL';
const project: Project = {
  id: 'project123', title: 'Aster studio website', clientName: 'Jordan',
  clientEmail: 'sb-buyer@personal.example.com', brief: 'A three-page website with one revision.',
  currency: 'AUD', rateCard: [], scope: [], scopeStatus: 'confirmed', scopeVersion: 1,
  baseAmountCents: 120000, revisionAllowance: 1, createdAt: '2026-10-24T00:00:00.000Z',
};
const quote: ChangeQuote = {
  id: 'quote123', projectId: project.id, analysisId: 'analysis123', scopeVersion: 1,
  lines: [{ id: 'line1', description: 'Additional page', quantity: 2, unitPriceCents: 12550 }],
  totalCents: 25100, currency: 'AUD', status: 'accepted', createdAt: project.createdAt,
};
const money = (value: string) => ({ currency_code: 'AUD', value });
const rawInvoice = (overrides: Record<string, unknown> = {}) => ({
  id: invoiceId, status: 'SENT',
  detail: { invoice_number: invoiceNumber, reference: `ScopePay ${quote.id}`, currency_code: 'AUD', metadata: { recipient_view_url: sandboxLink } },
  primary_recipients: [{ billing_info: { email_address: project.clientEmail } }],
  amount: money('251.00'), due_amount: money('251.00'), payments: { paid_amount: money('0.00'), transactions: [] },
  ...overrides,
});
const paypalTransaction = (value: string, id = 'PAYMENT123') => ({ type: 'PAYPAL', payment_id: id, method: 'PAYPAL', amount: money(value) });
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let paypal: typeof import('../server/paypal.js');
let fetchMock = vi.fn<typeof fetch>();

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('PAYMENT_PROVIDER', 'paypal-sandbox');
  vi.stubEnv('PAYPAL_CLIENT_ID', 'sandbox-client-id');
  vi.stubEnv('PAYPAL_CLIENT_SECRET', 'very-private-sandbox-secret');
  vi.stubEnv('PAYPAL_MERCHANT_EMAIL', 'sb-seller@business.example.com');
  vi.stubEnv('PAYPAL_WEBHOOK_ID', 'WH-REGISTERED');
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetchMock);
  paypal = await import('../server/paypal.js');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function tokenResponse() {
  return jsonResponse({ access_token: 'sandbox-access-token', expires_in: 3600 });
}

describe('PayPal sandbox adapter', () => {
  it('reports explicit modes and never calls PayPal while running the example', async () => {
    vi.stubEnv('PAYMENT_PROVIDER', 'example');
    expect(paypal.getPaymentInfo()).toEqual({ provider: 'example', configured: true });
    await expect(paypal.getPayPalInvoice(invoiceId)).rejects.toMatchObject({ code: 'PAYPAL_NOT_CONFIGURED' });
    vi.stubEnv('PAYMENT_PROVIDER', 'paypal-live');
    expect(paypal.getPaymentInfo()).toEqual({ provider: 'paypal-sandbox', configured: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caches the OAuth token and refreshes it before expiry', async () => {
    let clock = 1_800_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    fetchMock.mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse(rawInvoice()))
      .mockResolvedValueOnce(jsonResponse(rawInvoice()))
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse(rawInvoice()));
    await paypal.getPayPalInvoice(invoiceId);
    clock += 30_000;
    await paypal.getPayPalInvoice(invoiceId);
    clock += 3_600_000;
    await paypal.getPayPalInvoice(invoiceId);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/v1/oauth2/token'))).toHaveLength(2);
    expect(fetchMock.mock.calls.every(([url]) => new URL(String(url)).origin === 'https://api-m.sandbox.paypal.com')).toBe(true);
  });

  it('creates an itemised invoice, enables payment without emails, then reads its state', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ items: [], total_pages: 0 }))
      .mockResolvedValueOnce(jsonResponse({ id: invoiceId }, 201))
      .mockResolvedValueOnce(jsonResponse(rawInvoice({ status: 'DRAFT' })))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(jsonResponse(rawInvoice()));
    const result = await paypal.createPayPalInvoice(project, quote, invoiceNumber);
    expect(result).toEqual({ externalId: invoiceId, paymentUrl: sandboxLink, status: 'unpaid', paidCents: 0 });
    const createCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/v2/invoicing/invoices'))!;
    const body = JSON.parse(String(createCall[1]?.body));
    expect(body.detail.invoice_number).toBe(invoiceNumber);
    expect(body.detail.invoice_date).toBeUndefined();
    expect(body.items[0].unit_amount).toEqual(money('125.50'));
    expect(body.items[0].quantity).toBe('2');
    expect(body.primary_recipients[0].billing_info.email_address).toBe(project.clientEmail);
    const sendCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/send'))!;
    expect(JSON.parse(String(sendCall[1]?.body))).toEqual({ send_to_recipient: false, send_to_invoicer: false });
  });

  it('recovers an existing draft instead of creating a second invoice', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ items: [rawInvoice({ status: 'DRAFT' })] }))
      .mockResolvedValueOnce(jsonResponse(rawInvoice({ status: 'DRAFT' })))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(jsonResponse(rawInvoice()));
    await paypal.createPayPalInvoice(project, quote, invoiceNumber);
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/v2/invoicing/invoices') && init?.method === 'POST')).toBe(false);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/send'))).toHaveLength(1);
  });

  it('reconciles a duplicate invoice number using the exact match', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ details: [{ issue: 'DUPLICATE_INVOICE_NUMBER' }] }, 422))
      .mockResolvedValueOnce(jsonResponse({ items: [rawInvoice()] }))
      .mockResolvedValueOnce(jsonResponse(rawInvoice()));
    const result = await paypal.createPayPalInvoice(project, quote, invoiceNumber);
    expect(result.externalId).toBe(invoiceId);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/v2/invoicing/invoices'))).toHaveLength(1);
  });

  it('never blindly repeats a create request after an uncertain network result', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockRejectedValueOnce(new Error('Connection reset; very-private-sandbox-secret sandbox-access-token'))
      .mockResolvedValueOnce(jsonResponse({ items: [] }));
    let failure: unknown;
    try { await paypal.createPayPalInvoice(project, quote, invoiceNumber); }
    catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'PAYPAL_RECONCILIATION_REQUIRED' });
    expect(String(failure)).not.toContain('very-private-sandbox-secret');
    expect(String(failure)).not.toContain('sandbox-access-token');
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/v2/invoicing/invoices'))).toHaveLength(1);
  });

  it('preserves the external invoice ID when sending cannot be confirmed', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ items: [rawInvoice({ status: 'DRAFT' })] }))
      .mockResolvedValueOnce(jsonResponse(rawInvoice({ status: 'DRAFT' })))
      .mockResolvedValueOnce(jsonResponse({ message: 'sensitive upstream detail' }, 500))
      .mockResolvedValueOnce(jsonResponse(rawInvoice({ status: 'DRAFT' })));
    await expect(paypal.createPayPalInvoice(project, quote, invoiceNumber))
      .rejects.toMatchObject({ code: 'PAYPAL_SEND_UNCONFIRMED', externalId: invoiceId });
  });

  it('rejects a reused invoice whose amount or reference changed', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ items: [rawInvoice()] }))
      .mockResolvedValueOnce(jsonResponse(rawInvoice({ amount: money('999.00') })));
    await expect(paypal.createPayPalInvoice(project, quote, invoiceNumber)).rejects.toMatchObject({ code: 'PAYPAL_INVOICE_MISMATCH' });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/send'))).toBe(false);
  });

  it.each([
    { title: 'part payment', raw: { status: 'PARTIALLY_PAID', due_amount: money('151.00'), payments: { paid_amount: money('100.00'), transactions: [paypalTransaction('100.00')] } }, expected: 'partially_paid', paid: 10000 },
    { title: 'pending payment', raw: { status: 'PAYMENT_PENDING', due_amount: money('0.00'), payments: { paid_amount: money('251.00'), transactions: [paypalTransaction('251.00')] } }, expected: 'pending', paid: 0 },
    { title: 'manual payment', raw: { status: 'MARKED_AS_PAID', due_amount: money('0.00'), payments: { paid_amount: money('251.00'), transactions: [{ type: 'EXTERNAL', amount: money('251.00') }] } }, expected: 'pending', paid: 0 },
    { title: 'paid status with outstanding amount', raw: { status: 'PAID', due_amount: money('51.00'), payments: { paid_amount: money('200.00'), transactions: [paypalTransaction('200.00')] } }, expected: 'partially_paid', paid: 20000 },
    { title: 'paid status without PayPal evidence', raw: { status: 'PAID', due_amount: money('0.00'), payments: { paid_amount: money('251.00'), transactions: [] } }, expected: 'pending', paid: 0 },
    { title: 'confirmed full PayPal payment', raw: { status: 'PAID', due_amount: money('0.00'), payments: { paid_amount: money('251.00'), transactions: [paypalTransaction('251.00')] } }, expected: 'paid', paid: 25100 },
  ])('normalises $title without trusting the event name', async ({ raw, expected, paid }) => {
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(jsonResponse(rawInvoice(raw)));
    const result = await paypal.getPayPalInvoice(invoiceId);
    expect(result.status).toBe(expected);
    expect(result.paidCents).toBe(paid);
    expect(result.amountCents).toBe(25100);
    expect(result.currency).toBe('AUD');
  });

  it('rejects live or lookalike payment links', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(jsonResponse(rawInvoice({
      detail: { metadata: { recipient_view_url: 'https://www.paypal.com/invoice/p/#LIVE' } },
      links: [{ rel: 'payer-view', href: 'https://sandbox.paypal.com.attacker.example/invoice/p/#FAKE' }],
    })));
    expect((await paypal.getPayPalInvoice(invoiceId)).paymentUrl).toBeNull();
  });

  it('keeps unapproved or inconsistent quotes away from the PayPal API', async () => {
    await expect(paypal.createPayPalInvoice(project, { ...quote, status: 'approved' }, invoiceNumber)).rejects.toMatchObject({ code: 'PAYPAL_INVALID_INPUT' });
    await expect(paypal.createPayPalInvoice(project, { ...quote, totalCents: 1 }, invoiceNumber)).rejects.toMatchObject({ code: 'PAYPAL_INVALID_INPUT' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never includes upstream errors or secrets in returned errors', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error_description: 'very-private-sandbox-secret reflected here' }, 401));
    let failure: unknown;
    try { await paypal.getPayPalInvoice(invoiceId); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'PAYPAL_AUTH_FAILED' });
    expect(JSON.stringify(failure)).not.toContain('very-private-sandbox-secret');
    expect(String(failure)).not.toContain('reflected');
  });

  const headers = {
    'paypal-transmission-id': 'transmission123', 'paypal-transmission-time': '2026-10-24T10:00:00Z',
    'paypal-transmission-sig': 'signature', 'paypal-auth-algo': 'SHA256withRSA',
    'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-123',
  };
  const event = { id: 'WH-EVENT-123', event_type: 'INVOICING.INVOICE.PAID', resource: { id: invoiceId } };

  it('submits webhook headers, event and configured webhook ID for verification', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(jsonResponse({ verification_status: 'SUCCESS' }));
    expect(await paypal.verifyPayPalWebhook(headers, event)).toBe(true);
    const verification = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(verification.webhook_id).toBe('WH-REGISTERED');
    expect(verification.webhook_event).toEqual(event);
    expect(verification.transmission_sig).toBe('signature');
  });

  it('rejects failed verification and malformed headers', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(jsonResponse({ verification_status: 'FAILURE' }));
    expect(await paypal.verifyPayPalWebhook(headers, event)).toBe(false);
    expect(await paypal.verifyPayPalWebhook({ ...headers, 'paypal-cert-url': 'https://attacker.example/cert' }, event)).toBe(false);
    expect(await paypal.verifyPayPalWebhook({}, event)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('propagates transient verification failures so PayPal can retry delivery', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(jsonResponse({}, 503));
    await expect(paypal.verifyPayPalWebhook(headers, event)).rejects.toMatchObject({ code: 'PAYPAL_REQUEST_FAILED', httpStatus: 503 });
  });
});
