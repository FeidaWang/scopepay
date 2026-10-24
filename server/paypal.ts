import { createHash } from 'node:crypto';
import type { ChangeQuote, InvoiceStatus, Project, RuntimeInfo } from '../shared/types.js';

// Deliberately not configurable: this prototype must never move real money.
const PAYPAL_BASE = 'https://api-m.sandbox.paypal.com';
const REQUEST_TIMEOUT_MS = 15_000;
const INVOICE_ID = /^INV2-[A-Z0-9-]{8,30}$/i;
type JsonObject = Record<string, unknown>;
type ErrorCode =
  | 'PAYPAL_NOT_CONFIGURED' | 'PAYPAL_INVALID_INPUT' | 'PAYPAL_AUTH_FAILED'
  | 'PAYPAL_TIMEOUT' | 'PAYPAL_NETWORK_ERROR' | 'PAYPAL_RESPONSE_INVALID'
  | 'PAYPAL_REQUEST_FAILED' | 'PAYPAL_DUPLICATE_INVOICE_NUMBER'
  | 'PAYPAL_RECONCILIATION_REQUIRED' | 'PAYPAL_INVOICE_MISMATCH'
  | 'PAYPAL_SEND_UNCONFIRMED';

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  PAYPAL_NOT_CONFIGURED: 'Configure the PayPal sandbox credentials, merchant email and webhook ID first.',
  PAYPAL_INVALID_INPUT: 'The accepted quote or sandbox account details are not valid for invoicing.',
  PAYPAL_AUTH_FAILED: 'PayPal sandbox authentication failed. Check the sandbox app credentials.',
  PAYPAL_TIMEOUT: 'PayPal sandbox took too long to respond. Refresh the payment state before retrying.',
  PAYPAL_NETWORK_ERROR: 'PayPal sandbox could not be reached. Check the connection and refresh the payment state.',
  PAYPAL_RESPONSE_INVALID: 'PayPal sandbox returned an incomplete or unexpected response.',
  PAYPAL_REQUEST_FAILED: 'PayPal sandbox could not complete this request. Check the sandbox app and invoice.',
  PAYPAL_DUPLICATE_INVOICE_NUMBER: 'This invoice number already exists. Reconcile the existing sandbox invoice.',
  PAYPAL_RECONCILIATION_REQUIRED: 'The invoice creation result is uncertain. Keep this quote and invoice number; retry reconciliation before creating anything else.',
  PAYPAL_INVOICE_MISMATCH: 'The existing PayPal invoice does not match the accepted quote. Review it before continuing.',
  PAYPAL_SEND_UNCONFIRMED: 'The sandbox invoice exists, but its payable state could not be confirmed. Retry this same quote to recover it.',
};

/** Safe for the API response: no upstream messages, payloads, tokens or causes. */
export class PayPalOperationError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus?: number;
  readonly externalId?: string;

  constructor(code: ErrorCode, options: { httpStatus?: number; externalId?: string } = {}) {
    super(ERROR_MESSAGES[code]);
    this.name = 'PayPalOperationError';
    this.code = code;
    this.httpStatus = options.httpStatus;
    this.externalId = options.externalId && INVOICE_ID.test(options.externalId) ? options.externalId : undefined;
  }
}

const object = (value: unknown): JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : {};
const string = (value: unknown): string => typeof value === 'string' ? value : '';
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const emailIsValid = (value: string): boolean => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

function settings() {
  return {
    clientId: process.env.PAYPAL_CLIENT_ID?.trim() ?? '',
    clientSecret: process.env.PAYPAL_CLIENT_SECRET?.trim() ?? '',
    merchantEmail: process.env.PAYPAL_MERCHANT_EMAIL?.trim() ?? '',
    webhookId: process.env.PAYPAL_WEBHOOK_ID?.trim() ?? '',
  };
}

export function getPaymentInfo(): RuntimeInfo['payments'] {
  const configuredProvider = process.env.PAYMENT_PROVIDER;
  if (!configuredProvider || configuredProvider === 'example') return { provider: 'example', configured: true };
  const config = settings();
  return {
    provider: 'paypal-sandbox',
    configured: configuredProvider === 'paypal-sandbox'
      && Boolean(config.clientId && config.clientSecret && config.webhookId)
      && emailIsValid(config.merchantEmail),
  };
}

function requireSandbox() {
  if (process.env.PAYMENT_PROVIDER !== 'paypal-sandbox' || !getPaymentInfo().configured) {
    throw new PayPalOperationError('PAYPAL_NOT_CONFIGURED');
  }
  return settings();
}

let tokenCache: { key: string; token: string; expiresAt: number } | undefined;
let pendingToken: { key: string; promise: Promise<string> } | undefined;

async function fetchJson(path: string, init: RequestInit): Promise<{ status: number; ok: boolean; data: JsonObject }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${PAYPAL_BASE}${path}`, { ...init, redirect: 'error', signal: controller.signal });
    const raw = await response.text();
    let data: JsonObject = {};
    if (raw) {
      try { data = object(JSON.parse(raw)); }
      catch { throw new PayPalOperationError('PAYPAL_RESPONSE_INVALID', { httpStatus: response.status }); }
    }
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    if (error instanceof PayPalOperationError) throw error;
    throw new PayPalOperationError(controller.signal.aborted ? 'PAYPAL_TIMEOUT' : 'PAYPAL_NETWORK_ERROR');
  } finally {
    clearTimeout(timeout);
  }
}

async function accessToken(forceRefresh = false): Promise<string> {
  const config = requireSandbox();
  const key = createHash('sha256').update(`${config.clientId}\0${config.clientSecret}`).digest('hex');
  if (!forceRefresh && tokenCache?.key === key && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  if (pendingToken?.key === key) return pendingToken.promise;
  const promise = (async () => {
    const response = await fetchJson('/v1/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!response.ok) throw new PayPalOperationError('PAYPAL_AUTH_FAILED', { httpStatus: response.status });
    const token = string(response.data.access_token);
    const seconds = response.data.expires_in;
    if (!token || typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
      throw new PayPalOperationError('PAYPAL_RESPONSE_INVALID');
    }
    tokenCache = {
      key, token,
      // Refresh before expiry, including short-lived tokens returned by tests or PayPal.
      expiresAt: Date.now() + Math.max(1, seconds - Math.min(60, seconds / 10)) * 1000,
    };
    return token;
  })();
  pendingToken = { key, promise };
  try { return await promise; }
  finally { if (pendingToken?.promise === promise) pendingToken = undefined; }
}

async function api(method: 'GET' | 'POST', path: string, body?: unknown, readOnly = false): Promise<JsonObject> {
  let token = await accessToken();
  const perform = () => fetchJson(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let response = await perform();
  // Only read operations can be retried automatically. Mutating responses may be ambiguous.
  if (response.status === 401 && readOnly) {
    token = await accessToken(true);
    response = await perform();
  }
  if (!response.ok) {
    if (response.status === 401) {
      tokenCache = undefined;
      throw new PayPalOperationError('PAYPAL_AUTH_FAILED', { httpStatus: 401 });
    }
    const issues = list(response.data.details).map(item => string(object(item).issue));
    const duplicate = issues.includes('DUPLICATE_INVOICE_NUMBER') || response.data.name === 'DUPLICATE_INVOICE_NUMBER';
    throw new PayPalOperationError(duplicate ? 'PAYPAL_DUPLICATE_INVOICE_NUMBER' : 'PAYPAL_REQUEST_FAILED', { httpStatus: response.status });
  }
  return response.data;
}

function cents(value: unknown, currency: string): number | null {
  const money = object(value);
  if (money.currency_code !== currency || typeof money.value !== 'string' || !/^\d{1,12}(?:\.\d{1,2})?$/.test(money.value)) return null;
  const [whole, fraction = ''] = money.value.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(result) ? result : null;
}

function sandboxPaymentUrl(invoice: JsonObject): string | null {
  const detail = object(invoice.detail);
  const candidates = [
    object(detail.metadata).recipient_view_url,
    object(invoice.metadata).recipient_view_url,
    invoice.recipient_view_url,
    ...list(invoice.links).filter(link => ['payer-view', 'recipient-view', 'pay'].includes(string(object(link).rel)))
      .map(link => object(link).href),
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === 'https:' && ['sandbox.paypal.com', 'www.sandbox.paypal.com'].includes(url.hostname)
        && !url.username && !url.password && !url.port && url.pathname.startsWith('/invoice/')) return url.href;
    } catch { /* Ignore malformed upstream links; never synthesise a live PayPal link. */ }
  }
  return null;
}

type PayPalInvoiceResult = {
  externalId: string; paymentUrl: string | null; status: InvoiceStatus;
  paidCents: number; amountCents: number; currency: string;
};

function normaliseInvoice(raw: JsonObject, expectedId: string): PayPalInvoiceResult {
  if (raw.id !== expectedId) throw new PayPalOperationError('PAYPAL_RESPONSE_INVALID');
  const currency = string(object(raw.amount).currency_code);
  const amountCents = cents(raw.amount, currency);
  if (currency !== 'AUD' || amountCents === null || amountCents <= 0) throw new PayPalOperationError('PAYPAL_RESPONSE_INVALID');
  const rawStatus = string(raw.status).toUpperCase();
  const dueCents = cents(raw.effective_due_amount ?? raw.due_amount, currency);
  const payments = object(raw.payments);
  const aggregatePaid = cents(payments.paid_amount, currency);
  let paypalPaid = 0;
  const seenPayments = new Set<string>();
  for (const value of list(payments.transactions)) {
    const transaction = object(value);
    const id = string(transaction.payment_id);
    const amount = cents(transaction.amount, currency);
    if (transaction.type !== 'PAYPAL' || !id || seenPayments.has(id) || amount === null) continue;
    if (transaction.status && !['COMPLETED', 'SUCCESS', 'PAID'].includes(string(transaction.status).toUpperCase())) continue;
    seenPayments.add(id);
    paypalPaid += amount;
  }
  let refunded = 0;
  for (const value of list(object(raw.refunds).transactions)) {
    refunded += cents(object(value).amount, currency) ?? 0;
  }
  // A manual/external record is never evidence that a PayPal payment settled.
  let paidCents = Math.min(amountCents, Math.max(0, paypalPaid - refunded));
  if (aggregatePaid !== null) paidCents = Math.min(paidCents, aggregatePaid);
  let status: InvoiceStatus = 'unpaid';
  if (rawStatus === 'CANCELLED') status = 'cancelled';
  else if (['PAYMENT_PENDING', 'MARKED_AS_PAID', 'REFUNDED', 'PARTIALLY_REFUNDED', 'MARKED_AS_REFUNDED'].includes(rawStatus)) {
    status = 'pending';
    if (rawStatus === 'PAYMENT_PENDING' || rawStatus === 'REFUNDED' || rawStatus === 'MARKED_AS_REFUNDED') paidCents = 0;
  } else if (rawStatus === 'PAID') {
    // The webhook event name alone is insufficient. Require the fetched state,
    // zero outstanding balance and actual PayPal transaction evidence to agree.
    status = dueCents === 0 && paidCents >= amountCents ? 'paid'
      : paidCents > 0 && paidCents < amountCents ? 'partially_paid' : 'pending';
  } else if (rawStatus === 'PARTIALLY_PAID' || paidCents > 0) status = 'partially_paid';
  else if (!['DRAFT', 'SENT', 'UNPAID', 'SCHEDULED'].includes(rawStatus)) status = 'pending';
  return { externalId: expectedId, paymentUrl: sandboxPaymentUrl(raw), status, paidCents, amountCents, currency };
}

async function readInvoice(externalId: string): Promise<JsonObject> {
  if (!INVOICE_ID.test(externalId)) throw new PayPalOperationError('PAYPAL_INVALID_INPUT');
  return api('GET', `/v2/invoicing/invoices/${encodeURIComponent(externalId)}`, undefined, true);
}

export async function getPayPalInvoice(externalId: string): Promise<PayPalInvoiceResult> {
  requireSandbox();
  return normaliseInvoice(await readInvoice(externalId), externalId);
}

async function findInvoice(invoiceNumber: string): Promise<string | null> {
  // Invoice-number searches may be fuzzy: match the number ourselves before reuse.
  for (let page = 1; page <= 10; page += 1) {
    const result = await api('POST', `/v2/invoicing/search-invoices?page=${page}&page_size=100&total_required=true`, { invoice_number: invoiceNumber }, true);
    if (!Array.isArray(result.items)) throw new PayPalOperationError('PAYPAL_RESPONSE_INVALID');
    const matches = result.items.map(object).filter(item => object(item.detail).invoice_number === invoiceNumber);
    if (matches.length > 1) throw new PayPalOperationError('PAYPAL_INVOICE_MISMATCH');
    if (matches.length === 1) {
      const id = string(matches[0].id);
      if (!INVOICE_ID.test(id)) throw new PayPalOperationError('PAYPAL_RESPONSE_INVALID');
      return id;
    }
    if (result.items.length < 100 || (typeof result.total_pages === 'number' && page >= result.total_pages)) return null;
  }
  // Never create a new invoice after an incomplete search.
  throw new PayPalOperationError('PAYPAL_RECONCILIATION_REQUIRED');
}

function invoiceIdFromResponse(response: JsonObject): string | null {
  if (INVOICE_ID.test(string(response.id))) return string(response.id);
  const candidates = [response.href, ...list(response.links).filter(link => object(link).rel === 'self').map(link => object(link).href)];
  for (const candidate of candidates) {
    try {
      const url = new URL(string(candidate));
      const id = url.pathname.split('/').at(-1) ?? '';
      if (url.protocol === 'https:' && ['api-m.sandbox.paypal.com', 'api.sandbox.paypal.com'].includes(url.hostname)
        && !url.username && !url.password && !url.port
        && url.pathname.startsWith('/v2/invoicing/invoices/') && INVOICE_ID.test(id)) return id;
    } catch { /* A minimal create response may have only a validated self link. */ }
  }
  return null;
}

function validateQuote(project: Project, quote: ChangeQuote, invoiceNumber: string): void {
  const validLines = quote.lines.length > 0 && quote.lines.length <= 100 && quote.lines.every(line =>
    Boolean(line.description.trim()) && line.description.length <= 1000
    && Number.isSafeInteger(line.unitPriceCents) && line.unitPriceCents > 0
    && Number.isFinite(line.quantity) && line.quantity > 0 && line.quantity <= 1_000_000
    && /^\d+(?:\.\d{1,5})?$/.test(String(line.quantity))
    && Number.isSafeInteger(line.unitPriceCents * line.quantity));
  const total = quote.lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
  if (!validLines || !Number.isSafeInteger(total) || total <= 0 || total !== quote.totalCents
    || project.id !== quote.projectId || project.currency !== 'AUD' || quote.currency !== 'AUD'
    || quote.scopeVersion !== project.scopeVersion || project.scopeStatus !== 'confirmed'
    || !['accepted', 'invoiced'].includes(quote.status) || !emailIsValid(project.clientEmail)
    || !/^[A-Za-z0-9_-]{1,25}$/.test(invoiceNumber) || !quote.id || quote.id.length > 100) {
    throw new PayPalOperationError('PAYPAL_INVALID_INPUT');
  }
}

function assertMatches(raw: JsonObject, project: Project, quote: ChangeQuote, invoiceNumber: string): void {
  const detail = object(raw.detail);
  const recipient = object(object(list(raw.primary_recipients)[0]).billing_info);
  const total = cents(raw.amount, quote.currency);
  if (detail.invoice_number !== invoiceNumber || detail.reference !== `ScopePay ${quote.id}`
    || total !== quote.totalCents || string(recipient.email_address).toLowerCase() !== project.clientEmail.toLowerCase()) {
    throw new PayPalOperationError('PAYPAL_INVOICE_MISMATCH', { externalId: string(raw.id) });
  }
}

export async function createPayPalInvoice(
  project: Project, quote: ChangeQuote, invoiceNumber: string,
): Promise<{ externalId: string; paymentUrl: string | null; status: InvoiceStatus; paidCents: number }> {
  const config = requireSandbox();
  validateQuote(project, quote, invoiceNumber);
  let externalId = await findInvoice(invoiceNumber);
  if (!externalId) {
    try {
      const created = await api('POST', '/v2/invoicing/invoices', {
        detail: {
          invoice_number: invoiceNumber,
          reference: `ScopePay ${quote.id}`,
          currency_code: quote.currency,
          note: `Accepted scope change for ${project.title}`.slice(0, 1000),
          payment_term: { term_type: 'DUE_ON_RECEIPT' },
          // Omit invoice_date so PayPal uses its current date, not a future date
          // caused by the merchant and Melbourne having different time zones.
        },
        invoicer: { email_address: config.merchantEmail },
        primary_recipients: [{ billing_info: { email_address: project.clientEmail } }],
        items: quote.lines.map(line => ({
          name: line.description.slice(0, 200), description: line.description,
          quantity: String(line.quantity),
          unit_amount: { currency_code: quote.currency, value: (line.unitPriceCents / 100).toFixed(2) },
          unit_of_measure: 'QUANTITY',
        })),
        configuration: { partial_payment: { allow_partial_payment: false }, allow_tip: false },
      });
      externalId = invoiceIdFromResponse(created);
      if (!externalId) throw new PayPalOperationError('PAYPAL_RESPONSE_INVALID');
    } catch (error) {
      const uncertain = error instanceof PayPalOperationError && (
        ['PAYPAL_TIMEOUT', 'PAYPAL_NETWORK_ERROR', 'PAYPAL_RESPONSE_INVALID', 'PAYPAL_DUPLICATE_INVOICE_NUMBER'].includes(error.code)
        || (error.httpStatus !== undefined && error.httpStatus >= 500)
      );
      if (!uncertain) throw error;
      // This is a read/search only. Never repeat the POST after an ambiguous response.
      try { externalId = await findInvoice(invoiceNumber); }
      catch { throw new PayPalOperationError('PAYPAL_RECONCILIATION_REQUIRED'); }
      if (!externalId) throw new PayPalOperationError('PAYPAL_RECONCILIATION_REQUIRED');
    }
  }
  let invoice: JsonObject;
  try { invoice = await readInvoice(externalId); }
  catch { throw new PayPalOperationError('PAYPAL_SEND_UNCONFIRMED', { externalId }); }
  assertMatches(invoice, project, quote, invoiceNumber);
  if (invoice.status === 'DRAFT') {
    try {
      await api('POST', `/v2/invoicing/invoices/${encodeURIComponent(externalId)}/send`, {
        send_to_recipient: false, send_to_invoicer: false,
      });
    } catch { /* A failed response can still mean send succeeded; check below. */ }
    try { invoice = await readInvoice(externalId); }
    catch { throw new PayPalOperationError('PAYPAL_SEND_UNCONFIRMED', { externalId }); }
    assertMatches(invoice, project, quote, invoiceNumber);
    if (invoice.status === 'DRAFT' || invoice.status === 'SCHEDULED') {
      throw new PayPalOperationError('PAYPAL_SEND_UNCONFIRMED', { externalId });
    }
  }
  if (invoice.status === 'SCHEDULED') throw new PayPalOperationError('PAYPAL_SEND_UNCONFIRMED', { externalId });
  const result = normaliseInvoice(invoice, externalId);
  return { externalId: result.externalId, paymentUrl: result.paymentUrl, status: result.status, paidCents: result.paidCents };
}

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string | null {
  const value = Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
  return typeof value === 'string' && value.length <= 8192 && !/[\r\n]/.test(value) ? value : null;
}

export async function verifyPayPalWebhook(headers: Record<string, string | string[] | undefined>, event: unknown): Promise<boolean> {
  const config = requireSandbox();
  const transmissionId = headerValue(headers, 'paypal-transmission-id');
  const transmissionTime = headerValue(headers, 'paypal-transmission-time');
  const transmissionSig = headerValue(headers, 'paypal-transmission-sig');
  const certUrl = headerValue(headers, 'paypal-cert-url');
  const authAlgo = headerValue(headers, 'paypal-auth-algo');
  if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo
    || !string(object(event).id) || !string(object(event).event_type)) return false;
  try {
    const url = new URL(certUrl);
    if (url.protocol !== 'https:' || !['api.paypal.com', 'api-m.paypal.com', 'api.sandbox.paypal.com', 'api-m.sandbox.paypal.com'].includes(url.hostname)
      || url.username || url.password || url.port || !url.pathname.startsWith('/v1/notifications/certs/')) return false;
  } catch { return false; }
  // A 5xx/network failure must propagate so the webhook route can return 5xx and
  // PayPal can retry. FAILURE is a definitive rejection, not a transient error.
  const response = await api('POST', '/v1/notifications/verify-webhook-signature', {
    auth_algo: authAlgo, cert_url: certUrl, transmission_id: transmissionId,
    transmission_sig: transmissionSig, transmission_time: transmissionTime,
    webhook_id: config.webhookId, webhook_event: event,
  }, true);
  return response.verification_status === 'SUCCESS';
}
