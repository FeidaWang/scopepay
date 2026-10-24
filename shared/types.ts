export type Currency = 'AUD';
export type AIProvider = 'example' | 'ollama' | 'openai-compatible';
export type PaymentProvider = 'example' | 'paypal-sandbox';
export interface Rate { id: string; label: string; unit: string; unitPriceCents: number }
export interface ScopeItem { id: string; label: string; detail: string; quantity: number; unit: string; sourceQuote: string }
export interface Project {
  id: string; title: string; clientName: string; clientEmail: string; brief: string;
  currency: Currency; rateCard: Rate[]; scope: ScopeItem[]; scopeStatus: 'draft' | 'confirmed';
  scopeVersion: number; baseAmountCents: number; revisionAllowance: number; createdAt: string;
}
export interface AnalysisItem {
  id: string; request: string; evidence: string; scopeItemId: string | null;
  classification: 'included' | 'additional' | 'clarify'; reason: string;
  question?: string; rateId: string | null; quantity: number;
}
export interface Analysis {
  id: string; projectId: string; message: string; items: AnalysisItem[];
  provider: AIProvider; model: string; createdAt: string; scopeVersion: number;
}
export interface QuoteLine { id: string; description: string; quantity: number; unitPriceCents: number }
export interface ChangeQuote {
  id: string; projectId: string; analysisId: string; scopeVersion: number;
  lines: QuoteLine[]; totalCents: number; currency: Currency;
  status: 'draft' | 'approved' | 'accepted' | 'invoiced'; createdAt: string;
  acceptedAt?: string; shareToken?: string;
}
export type InvoiceStatus = 'unpaid' | 'partially_paid' | 'pending' | 'paid' | 'cancelled';
export interface Invoice {
  id: string; projectId: string; quoteId: string; provider: PaymentProvider;
  externalId: string; amountCents: number; currency: Currency; status: InvoiceStatus;
  paymentUrl: string | null; paidCents: number; createdAt: string; updatedAt: string;
}
export interface Activity { id: string; projectId: string; kind: string; title: string; detail: string; createdAt: string }
export interface Workspace { projects: Project[]; analyses: Analysis[]; quotes: ChangeQuote[]; invoices: Invoice[]; activity: Activity[] }
export interface RuntimeInfo {
  version: string;
  ai: { provider: AIProvider; model: string; configured: boolean };
  payments: { provider: PaymentProvider; configured: boolean };
}
export interface BootstrapResponse { workspace: Workspace; runtime: RuntimeInfo; csrfToken: string }
export interface ClientReview {
  project: Pick<Project, 'id' | 'title' | 'clientName' | 'currency'>;
  quote: ChangeQuote; invoice: Invoice | null; mode: PaymentProvider;
}
