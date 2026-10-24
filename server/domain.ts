import type { Analysis, Project, QuoteLine } from '../shared/types.js';

/** Money is stored and calculated in integer cents, never binary decimal dollars. */
export const MAX_QUOTE_CENTS = 100_000_000; // A$1,000,000
export const MAX_LINE_QUANTITY = 1_000;
export const MAX_QUOTE_LINES = 40;

function positiveInteger(value: unknown, maximum: number, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label} must be a whole number between 1 and ${maximum.toLocaleString('en-AU')}.`);
  }
}

export function calculateQuoteTotal(lines: QuoteLine[]): number {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > MAX_QUOTE_LINES) {
    throw new Error(`Add between 1 and ${MAX_QUOTE_LINES} quote lines.`);
  }
  const ids = new Set<string>();
  let total = 0;
  for (const line of lines) {
    if (!line || typeof line !== 'object') throw new Error('Every quote line must contain a description, quantity and price.');
    if (typeof line.id !== 'string' || !line.id.trim() || line.id.length > 100 || ids.has(line.id)) {
      throw new Error('Every quote line must have a unique, valid request ID.');
    }
    ids.add(line.id);
    if (typeof line.description !== 'string' || !line.description.trim() || line.description.length > 500) {
      throw new Error('Quote descriptions must contain between 1 and 500 characters.');
    }
    positiveInteger(line.quantity, MAX_LINE_QUANTITY, 'Quantity');
    positiveInteger(line.unitPriceCents, MAX_QUOTE_CENTS, 'Unit price in cents');
    const lineTotal = line.quantity * line.unitPriceCents;
    if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(total + lineTotal) || total + lineTotal > MAX_QUOTE_CENTS) {
      throw new Error('A change quote cannot exceed A$1,000,000.');
    }
    total += lineTotal;
  }
  return total;
}

/**
 * A line ID is the analysed request ID. The merchant may edit its description,
 * quantity and price, but cannot turn an included or unresolved item into a charge.
 * Resolve classifications explicitly before calling this function.
 */
export function validateQuoteAgainstAnalysis(project: Project, analysis: Analysis, lines: QuoteLine[]): void {
  if (project.scopeStatus !== 'confirmed') throw new Error('Confirm the original scope before preparing a change quote.');
  if (project.currency !== 'AUD') throw new Error('This prototype supports Australian dollars only.');
  if (analysis.projectId !== project.id) throw new Error('This analysis belongs to a different project.');
  if (!Number.isSafeInteger(project.scopeVersion) || project.scopeVersion < 1 || analysis.scopeVersion !== project.scopeVersion) {
    throw new Error('The scope has changed. Analyse the request again before preparing a quote.');
  }
  if (!Array.isArray(analysis.items) || analysis.items.length < 1) throw new Error('Analyse a client request before preparing a quote.');
  if (analysis.items.some(item => item.classification === 'clarify')) {
    throw new Error('Resolve the items marked “Needs clarification” before preparing a quote.');
  }
  const itemIds = new Set(analysis.items.map(item => item.id));
  if (itemIds.size !== analysis.items.length) throw new Error('The analysis contains duplicate request IDs. Analyse the request again.');

  calculateQuoteTotal(lines);
  for (const line of lines) {
    const item = analysis.items.find(candidate => candidate.id === line.id);
    if (!item || item.classification !== 'additional') {
      throw new Error('A quote may only charge for additional work identified in this analysis.');
    }
    if (item.scopeItemId !== null && !project.scope.some(scope => scope.id === item.scopeItemId)) {
      throw new Error('A request refers to a scope item that no longer exists. Analyse it again.');
    }
    if (!item.rateId || !project.rateCard.some(rate => rate.id === item.rateId)) {
      throw new Error('Select a rate for each additional request before preparing a quote.');
    }
    positiveInteger(item.quantity, MAX_LINE_QUANTITY, 'Suggested quantity');
  }
}
