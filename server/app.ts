import express, { type Request, type Response, type NextFunction } from 'express';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z, ZodError } from 'zod';
import type { Analysis, ChangeQuote, ClientReview, Invoice, Project, RuntimeInfo, Workspace } from '../shared/types.js';
import { Store, type WorkspaceRecord } from './store.js';
import { analyseChange, extractScope, getAIInfo } from './ai.js';
import { calculateQuoteTotal, validateQuoteAgainstAnalysis } from './domain.js';
import { createPayPalInvoice, getPayPalInvoice, getPaymentInfo, verifyPayPalWebhook } from './paypal.js';

class AppError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
const text = (max: number) => z.string().trim().min(1).max(max);
const cents = z.number().int().min(0).max(100_000_000);
const scopeSchema = z.array(z.object({ id: text(100), label: text(200), detail: text(2000), quantity: z.number().int().min(1).max(10000), unit: text(80), sourceQuote: text(4000) })).min(1).max(30);
const linesSchema = z.array(z.object({ id: text(100), description: text(500), quantity: z.number().int().positive().max(1000), unitPriceCents: z.number().int().positive().max(100_000_000) })).min(1).max(30);
const projectSchema = z.object({ title: text(160), clientName: text(160), clientEmail: z.email().max(254), brief: text(12000), baseAmountCents: cents, revisionAllowance: z.number().int().min(0).max(20) });
const now = () => new Date().toISOString();
function findProject(w: Workspace, id: string): Project { const p = w.projects.find(p => p.id === id); if (!p) throw new AppError(404, 'NOT_FOUND', 'Project not found.'); return p; }
function findQuote(w: Workspace, id: string): ChangeQuote { const q = w.quotes.find(q => q.id === id); if (!q) throw new AppError(404, 'NOT_FOUND', 'Quote not found.'); return q; }
function findInvoice(w: Workspace, id: string): Invoice { const i = w.invoices.find(i => i.id === id); if (!i) throw new AppError(404, 'NOT_FOUND', 'Invoice not found.'); return i; }
function log(w: Workspace, projectId: string, kind: string, title: string, detail: string) { w.activity.unshift({ id: randomUUID(), projectId, kind, title, detail, createdAt: now() }); }
function runtime(): RuntimeInfo { return { version: '0.1.0', ai: getAIInfo(), payments: getPaymentInfo() }; }
function equal(a: string, b: string): boolean { const aa = Buffer.from(a); const bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); }
function review(record: WorkspaceRecord, quoteId: string): ClientReview {
  const quote = findQuote(record.workspace, quoteId); const project = findProject(record.workspace, quote.projectId);
  const { shareToken: _token, ...publicQuote } = quote;
  return { project: { id: project.id, title: project.title, clientName: project.clientName, currency: project.currency }, quote: publicQuote, invoice: record.workspace.invoices.find(i => i.quoteId === quote.id) || null, mode: getPaymentInfo().provider };
}
function validatePayment(invoice: Invoice, payment: Awaited<ReturnType<typeof getPayPalInvoice>>) {
  if (payment.currency !== invoice.currency || payment.amountCents !== invoice.amountCents || payment.externalId !== invoice.externalId) throw new AppError(409, 'PAYMENT_MISMATCH', 'The payment details do not match this quote. Check the invoice in PayPal.');
  invoice.status = payment.status; invoice.paidCents = payment.paidCents; invoice.paymentUrl = payment.paymentUrl; invoice.updatedAt = now();
}

export function createApp(store = new Store()) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' });
    if (process.env.NODE_ENV === 'production') res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    next();
  });
  app.use(express.json({ limit: '128kb' }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', version: '0.1.0' }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  // A webhook is authenticated by PayPal's signature, never by a visitor cookie.
  app.post('/api/paypal/webhook', async (req, res) => {
    if (getPaymentInfo().provider !== 'paypal-sandbox') throw new AppError(503, 'SANDBOX_NOT_CONFIGURED', 'PayPal sandbox is not enabled.');
    const event = z.object({ id: text(200), event_type: text(200), resource: z.record(z.string(), z.unknown()) }).parse(req.body);
    if (!await verifyPayPalWebhook(req.headers, req.body)) throw new AppError(401, 'INVALID_SIGNATURE', 'Webhook signature could not be verified.');
    if (store.hasEvent(event.id)) return void res.json({ received: true, duplicate: true });
    const externalId = typeof event.resource.id === 'string' ? event.resource.id : undefined;
    const ref = externalId ? store.findInvoice(externalId) : undefined;
    if (!ref || !event.event_type.startsWith('INVOICING.INVOICE.')) return void res.status(202).json({ received: true, ignored: true });
    await store.locked(ref.workspaceId, async record => {
      if (store.hasEvent(event.id)) return;
      const invoice = findInvoice(record.workspace, ref.invoiceId);
      const payment = await getPayPalInvoice(invoice.externalId);
      validatePayment(invoice, payment);
      log(record.workspace, invoice.projectId, 'payment', 'PayPal status checked', `Invoice ${invoice.externalId}: ${invoice.status.replaceAll('_', ' ')}.`);
      store.save(record); store.markEvent(event.id);
    });
    res.json({ received: true });
  });

  // Prevent browser cross-origin writes. Review links are high-entropy, revocable capabilities.
  app.use('/api', (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    const allowed = process.env.APP_URL ? new URL(process.env.APP_URL).origin : `${req.protocol}://${req.get('host')}`;
    if ((origin && origin !== allowed) || req.get('sec-fetch-site') === 'cross-site') throw new AppError(403, 'ORIGIN_REJECTED', 'Open ScopePay in the same browser tab and try again.');
    next();
  });
  app.get('/api/review/:token', (req, res) => {
    const found = store.findReview(req.params.token); const record = found && store.get(found.workspaceId);
    if (!found || !record) throw new AppError(404, 'NOT_FOUND', 'This review link is no longer available.');
    res.json(review(record, found.quoteId));
  });
  app.post('/api/review/:token/accept', async (req, res) => {
    z.object({ accepted: z.literal(true) }).parse(req.body);
    const found = store.findReview(req.params.token); if (!found) throw new AppError(404, 'NOT_FOUND', 'This review link is no longer available.');
    const result = await store.locked(found.workspaceId, record => {
      const quote = findQuote(record.workspace, found.quoteId);
      const project = findProject(record.workspace, quote.projectId);
      if (quote.scopeVersion !== project.scopeVersion || project.scopeStatus !== 'confirmed') throw new AppError(409, 'SCOPE_CHANGED', 'The project scope has changed. Ask for an updated quote.');
      if (quote.status === 'draft') throw new AppError(409, 'QUOTE_NOT_READY', 'This quote is still being prepared.');
      if (quote.status === 'approved') { quote.status = 'accepted'; quote.acceptedAt = now(); log(record.workspace, project.id, 'agreement', 'Client accepted the change', 'The reviewed quote is now ready to invoice.'); store.save(record); }
      return review(record, quote.id);
    }); res.json(result);
  });

  app.use('/api', (req, res, next) => {
    const match = /(?:^|;\s*)scopepay_session=([A-Za-z0-9_-]{43})(?:;|$)/.exec(req.headers.cookie || '');
    let record = match ? store.get(match[1]) : undefined;
    if (!record) { record = store.create(); res.cookie('scopepay_session', record.id, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 30 * 86400 * 1000, path: '/' }); }
    res.locals.workspaceId = record.id;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !equal(req.get('x-csrf-token') || '', record.csrf)) throw new AppError(403, 'CSRF_REJECTED', 'Your session has changed. Refresh the page and try again.');
    next();
  });
  app.get('/api/bootstrap', (_req, res) => { const r = store.get(res.locals.workspaceId)!; res.json({ workspace: r.workspace, runtime: runtime(), csrfToken: r.csrf }); });
  const mutate = (action: (req: Request, record: WorkspaceRecord) => Promise<unknown> | unknown) => async (req: Request, res: Response) => { const result = await store.locked(res.locals.workspaceId, record => action(req, record)); res.json(result); };
  const consumeAI = (record: WorkspaceRecord) => {
    if (!store.consume(record.id, 'ai', 30)) throw new AppError(429, 'AI_LIMIT', 'The hourly analysis limit for this workspace has been reached.');
    if (getAIInfo().provider !== 'example' && !store.consume('$global', 'ai', 100, 86_400_000)) throw new AppError(429, 'AI_LIMIT', 'This demo has reached its daily allowance of 100 model requests. Try again after the allowance resets.');
  };
  app.post('/api/reset', mutate((_req, record) => {
    if (record.workspace.invoices.some(i => i.provider === 'paypal-sandbox')) throw new AppError(409, 'PAYPAL_RECORDS_EXIST', 'Keep this workspace to preserve its PayPal invoice records. Use a separate browser profile for a fresh example.');
    store.reset(record); return { workspace: record.workspace, runtime: runtime(), csrfToken: record.csrf };
  }));
  app.post('/api/projects', mutate((req, record) => {
    if (record.workspace.projects.length >= 10) throw new AppError(429, 'PROJECT_LIMIT', 'This demo supports up to 10 projects per workspace.');
    const input = projectSchema.parse(req.body);
    const project: Project = { ...input, id: randomUUID(), currency: 'AUD', scope: [], scopeStatus: 'draft', scopeVersion: 1, rateCard: [ { id: 'extra-slide', label: 'Additional slide', unit: 'slide', unitPriceCents: 4500 }, { id: 'translation', label: 'Additional language version', unit: 'version', unitPriceCents: 18000 }, { id: 'revision', label: 'Additional revision round', unit: 'round', unitPriceCents: 9000 } ], createdAt: now() };
    record.workspace.projects.unshift(project); log(record.workspace, project.id, 'project', 'Project created', 'Review and confirm the scope before analysing changes.'); store.save(record); return { project, workspace: record.workspace };
  }));
  app.post('/api/projects/:id/scope/extract', mutate(async (req, record) => {
    const project = findProject(record.workspace, String(req.params.id));
    if (project.scopeStatus === 'confirmed') throw new AppError(409, 'SCOPE_CONFIRMED', 'Edit the scope first to create a new draft version.');
    consumeAI(record);
    const result = await extractScope(project); project.scope = result.scope;
    log(record.workspace, project.id, 'scope', 'Scope prepared for review', `Prepared with ${result.provider === 'example' ? 'example rules' : result.model}. Confirm the details before continuing.`);
    store.save(record); return { workspace: record.workspace };
  }));
  app.patch('/api/projects/:id/scope', mutate((req, record) => {
    const project = findProject(record.workspace, String(req.params.id));
    const input = z.object({ scope: scopeSchema, baseAmountCents: cents, revisionAllowance: z.number().int().min(0).max(20) }).parse(req.body);
    if (new Set(input.scope.map(s => s.id)).size !== input.scope.length) throw new AppError(400, 'DUPLICATE_SCOPE', 'Scope items need unique identifiers.');
    project.scope = input.scope; project.baseAmountCents = input.baseAmountCents; project.revisionAllowance = input.revisionAllowance; project.scopeStatus = 'draft'; project.scopeVersion += 1;
    log(record.workspace, project.id, 'scope', 'Scope updated', 'Confirm this new version before analysing another change.'); store.save(record); return { workspace: record.workspace };
  }));
  app.post('/api/projects/:id/scope/confirm', mutate((req, record) => {
    const project = findProject(record.workspace, String(req.params.id)); scopeSchema.parse(project.scope);
    project.scopeStatus = 'confirmed'; log(record.workspace, project.id, 'scope', 'Scope confirmed', `Version ${project.scopeVersion} is the reference for new change requests.`); store.save(record); return { workspace: record.workspace };
  }));
  app.post('/api/projects/:id/analyses', mutate(async (req, record) => {
    const project = findProject(record.workspace, String(req.params.id));
    if (project.scopeStatus !== 'confirmed') throw new AppError(409, 'SCOPE_NOT_CONFIRMED', 'Confirm the project scope before analysing changes.');
    const { message } = z.object({ message: text(5000) }).parse(req.body);
    if (record.workspace.analyses.length >= 100) throw new AppError(429, 'AI_LIMIT', 'The analysis limit for this workspace has been reached.');
    consumeAI(record);
    const result = await analyseChange(project, message);
    const analysis: Analysis = { ...result, id: randomUUID(), projectId: project.id, message, createdAt: now(), scopeVersion: project.scopeVersion };
    record.workspace.analyses.unshift(analysis); log(record.workspace, project.id, 'analysis', 'Change request reviewed', `${analysis.items.length} items prepared for your review.`); store.save(record); return { analysis, workspace: record.workspace };
  }));
  app.patch('/api/analyses/:id', mutate((req, record) => {
    const analysis = record.workspace.analyses.find(a => a.id === req.params.id); if (!analysis) throw new AppError(404, 'NOT_FOUND', 'Analysis not found.');
    if (record.workspace.quotes.some(q => q.analysisId === analysis.id)) throw new AppError(409, 'QUOTE_EXISTS', 'A quote already uses this analysis. Submit a new change request to revise the assessment.');
    const project = findProject(record.workspace, analysis.projectId);
    if (project.scopeVersion !== analysis.scopeVersion || project.scopeStatus !== 'confirmed') throw new AppError(409, 'SCOPE_CHANGED', 'Analyse this request again against the current scope.');
    const input = z.object({ items: z.array(z.object({ id: text(100), classification: z.enum(['included', 'additional', 'clarify']), rateId: z.string().nullable(), quantity: z.number().int().min(0).max(1000), reason: z.string().max(1500).optional() })).min(1).max(30) }).parse(req.body);
    if (new Set(input.items.map(i => i.id)).size !== input.items.length) throw new AppError(400, 'DUPLICATE_ITEM', 'Review each item once.');
    for (const change of input.items) {
      const item = analysis.items.find(i => i.id === change.id); if (!item) throw new AppError(400, 'INVALID_ITEM', 'This assessment item does not exist.');
      if (change.classification === 'additional' && (!project.rateCard.some(r => r.id === change.rateId) || change.quantity < 1)) throw new AppError(400, 'RATE_REQUIRED', 'Choose a rate and positive quantity for additional work.');
      item.classification = change.classification; item.rateId = change.classification === 'additional' ? change.rateId : null; item.quantity = change.quantity;
      item.reason = `Merchant reviewed: ${change.reason || item.reason}`.slice(0, 2000);
    }
    log(record.workspace, project.id, 'analysis', 'Assessment updated', 'Your decisions are saved alongside the original evidence.'); store.save(record); return { analysis, workspace: record.workspace };
  }));
  app.post('/api/projects/:id/quotes', mutate((req, record) => {
    const project = findProject(record.workspace, String(req.params.id)); const input = z.object({ analysisId: text(100), lines: linesSchema }).parse(req.body);
    const analysis = record.workspace.analyses.find(a => a.id === input.analysisId && a.projectId === project.id); if (!analysis) throw new AppError(404, 'NOT_FOUND', 'Analysis not found.');
    const existing = record.workspace.quotes.find(q => q.analysisId === input.analysisId && q.projectId === project.id); if (existing) return { quote: existing, workspace: record.workspace };
    if (record.workspace.quotes.length >= 100) throw new AppError(429, 'QUOTE_LIMIT', 'The quote limit for this workspace has been reached.');
    validateQuoteAgainstAnalysis(project, analysis, input.lines);
    const quote: ChangeQuote = { id: randomUUID(), projectId: project.id, analysisId: analysis.id, scopeVersion: project.scopeVersion, lines: input.lines, totalCents: calculateQuoteTotal(input.lines), currency: project.currency, status: 'draft', createdAt: now() };
    record.workspace.quotes.unshift(quote); log(record.workspace, project.id, 'quote', 'Change quote drafted', 'Review the line items before sharing with your client.'); store.save(record); return { quote, workspace: record.workspace };
  }));
  app.patch('/api/quotes/:id', mutate((req, record) => {
    const quote = findQuote(record.workspace, String(req.params.id)); if (quote.status !== 'draft') throw new AppError(409, 'QUOTE_LOCKED', 'Shared quotes are fixed so your client sees the agreed amount. Create a new assessment for a new quote.');
    const { lines } = z.object({ lines: linesSchema }).parse(req.body); const project = findProject(record.workspace, quote.projectId); const analysis = record.workspace.analyses.find(a => a.id === quote.analysisId)!;
    validateQuoteAgainstAnalysis(project, analysis, lines); quote.lines = lines; quote.totalCents = calculateQuoteTotal(lines); store.save(record); return { quote, workspace: record.workspace };
  }));
  app.post('/api/quotes/:id/approve', mutate((req, record) => {
    const quote = findQuote(record.workspace, String(req.params.id)); const project = findProject(record.workspace, quote.projectId); const analysis = record.workspace.analyses.find(a => a.id === quote.analysisId)!;
    validateQuoteAgainstAnalysis(project, analysis, quote.lines);
    if (quote.status === 'draft') { quote.status = 'approved'; quote.shareToken = randomBytes(32).toString('base64url'); log(record.workspace, project.id, 'agreement', 'Quote ready for your client', 'Share the private review link to collect their acceptance.'); store.save(record); }
    return { quote, workspace: record.workspace, shareUrl: `/review/${quote.shareToken}` };
  }));
  app.post('/api/quotes/:id/invoice', mutate(async (req, record) => {
    const quote = findQuote(record.workspace, String(req.params.id)); const existing = record.workspace.invoices.find(i => i.quoteId === quote.id); if (existing) return { invoice: existing, workspace: record.workspace };
    const project = findProject(record.workspace, quote.projectId);
    if (quote.status !== 'accepted' || !quote.acceptedAt) throw new AppError(409, 'CLIENT_ACCEPTANCE_REQUIRED', 'Your client needs to accept this quote before you create an invoice.');
    if (project.scopeVersion !== quote.scopeVersion || project.scopeStatus !== 'confirmed') throw new AppError(409, 'SCOPE_CHANGED', 'The project scope has changed. Prepare a new quote before invoicing.');
    if (!store.consume(record.id, 'invoice', 10)) throw new AppError(429, 'INVOICE_LIMIT', 'The hourly invoice limit for this workspace has been reached.');
    const provider = getPaymentInfo().provider;
    if (provider === 'paypal-sandbox' && !store.consume('$global', 'invoice', 50, 86_400_000)) throw new AppError(429, 'INVOICE_LIMIT', 'This demo has reached its daily allowance of 50 sandbox invoice attempts.');
    const number = store.operation(`invoice:${record.id}:${quote.id}`, `SP-${quote.id.replaceAll('-', '').slice(0, 22)}`);
    const result = provider === 'paypal-sandbox' ? await createPayPalInvoice(project, quote, number) : { externalId: `EXAMPLE-${quote.id.slice(0, 8)}`, paymentUrl: null, status: 'unpaid' as const, paidCents: 0 };
    const invoice: Invoice = { ...result, id: randomUUID(), projectId: project.id, quoteId: quote.id, provider, amountCents: quote.totalCents, currency: quote.currency, createdAt: now(), updatedAt: now() };
    record.workspace.invoices.unshift(invoice); quote.status = 'invoiced'; log(record.workspace, project.id, 'invoice', provider === 'example' ? 'Example invoice created' : 'PayPal invoice created', provider === 'example' ? 'This is a simulation. No PayPal request was made.' : `Sandbox invoice ${invoice.externalId} is ready.`); store.save(record); return { invoice, workspace: record.workspace };
  }));
  app.post('/api/invoices/:id/refresh', mutate(async (req, record) => {
    const invoice = findInvoice(record.workspace, String(req.params.id));
    if (invoice.provider === 'paypal-sandbox') validatePayment(invoice, await getPayPalInvoice(invoice.externalId));
    store.save(record); return { invoice, workspace: record.workspace };
  }));
  app.post('/api/invoices/:id/example-payment', mutate((req, record) => {
    const invoice = findInvoice(record.workspace, String(req.params.id));
    if (invoice.provider !== 'example' || getPaymentInfo().provider !== 'example') throw new AppError(403, 'SIMULATION_DISABLED', 'Payment simulation is only available for example invoices in Example mode.');
    const { outcome } = z.object({ outcome: z.enum(['paid', 'partial']) }).parse(req.body);
    if (invoice.status !== 'paid') { invoice.status = outcome === 'paid' ? 'paid' : 'partially_paid'; invoice.paidCents = outcome === 'paid' ? invoice.amountCents : Math.floor(invoice.amountCents / 2); invoice.updatedAt = now(); log(record.workspace, invoice.projectId, 'payment', 'Example payment simulated', 'No money moved. This is a walkthrough of the payment state.'); store.save(record); }
    return { invoice, workspace: record.workspace };
  }));
  app.use('/api', (_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'This API route does not exist.')));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const parserError = error as { type?: string };
    if (parserError?.type === 'entity.parse.failed') return void res.status(400).json({ error: { code: 'INVALID_JSON', message: 'The request must contain valid JSON.' } });
    if (parserError?.type === 'entity.too.large') return void res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'This request is too large. Shorten the project details and try again.' } });
    if (error instanceof ZodError) return void res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Check the required fields, quantities and amounts, then try again.', fields: error.issues.map(i => i.path.join('.')) } });
    if (error instanceof AppError) return void res.status(error.status).json({ error: { code: error.code, message: error.message } });
    // Provider modules expose only safe error messages. Never return credentials or upstream response bodies.
    const safe = error instanceof Error ? error.message : 'The request could not be completed.';
    const isInput = /scope|quote|quantity|amount|rate|clarif|line item|integer|analysis|confirmed|duplicate/i.test(safe);
    res.status(isInput ? 400 : 502).json({ error: { code: isInput ? 'INVALID_OPERATION' : 'SERVICE_UNAVAILABLE', message: safe.length <= 500 ? safe : 'The service could not complete this request. Check the server configuration.' } });
  });
  return { app, store };
}
