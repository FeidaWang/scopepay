import { describe, expect, it } from 'vitest';
import { calculateQuoteTotal, validateQuoteAgainstAnalysis, MAX_QUOTE_CENTS } from '../server/domain.js';
import { createSeedWorkspace } from '../server/seed.js';
import type { Analysis, QuoteLine } from '../shared/types.js';

const lines = (): QuoteLine[] => [
  { id: 'slides', description: 'Four additional slides', quantity: 4, unitPriceCents: 4_500 },
  { id: 'translation', description: 'Chinese version', quantity: 1, unitPriceCents: 18_000 },
];
function setup() {
  const project = createSeedWorkspace().projects[0];
  const analysis: Analysis = { id: 'analysis', projectId: project.id, scopeVersion: 1, message: 'Extra slides and Chinese version', provider: 'example', model: 'deterministic-rules-v1', createdAt: new Date().toISOString(), items: [
    { id: 'slides', request: 'Four extra slides', evidence: project.scope[0].sourceQuote, scopeItemId: project.scope[0].id, classification: 'additional', reason: 'Beyond the agreed deck', rateId: 'extra-slide', quantity: 4 },
    { id: 'translation', request: 'Chinese version', evidence: project.scope[1].sourceQuote, scopeItemId: project.scope[1].id, classification: 'additional', reason: 'English only', rateId: 'translation', quantity: 1 },
  ] };
  return { project, analysis };
}

describe('quote money', () => {
  it('totals in cents and honours the exact maximum', () => {
    expect(calculateQuoteTotal(lines())).toBe(36_000);
    expect(calculateQuoteTotal([{ id: 'max', description: 'Maximum', quantity: 1, unitPriceCents: MAX_QUOTE_CENTS }])).toBe(MAX_QUOTE_CENTS);
  });
  it.each([NaN, Infinity, -1, 0, 45.5, Number.MAX_SAFE_INTEGER])('rejects unsafe price %s', value => {
    expect(() => calculateQuoteTotal([{ ...lines()[0], unitPriceCents: value }])).toThrow();
  });
  it.each([NaN, Infinity, -1, 0, 1.1, 1_001])('rejects invalid quantity %s', quantity => {
    expect(() => calculateQuoteTotal([{ ...lines()[0], quantity }])).toThrow();
  });
  it('rejects duplicate IDs, empty lines and totals above the cap', () => {
    expect(() => calculateQuoteTotal([lines()[0], lines()[0]])).toThrow(/unique/);
    expect(() => calculateQuoteTotal([])).toThrow();
    expect(() => calculateQuoteTotal([{ id: 'over', description: 'Too much', quantity: 2, unitPriceCents: MAX_QUOTE_CENTS }])).toThrow(/exceed/);
  });
});

describe('quote agreement checks', () => {
  it('accepts evidence-linked lines and explicit merchant price edits', () => {
    const { project, analysis } = setup();
    expect(() => validateQuoteAgainstAnalysis(project, analysis, lines())).not.toThrow();
    expect(() => validateQuoteAgainstAnalysis(project, analysis, [{ ...lines()[0], quantity: 3, unitPriceCents: 4_000 }])).not.toThrow();
  });
  it('blocks unconfirmed, cross-project and superseded analyses', () => {
    const { project, analysis } = setup();
    expect(() => validateQuoteAgainstAnalysis({ ...project, scopeStatus: 'draft' }, analysis, lines())).toThrow(/Confirm/);
    expect(() => validateQuoteAgainstAnalysis(project, { ...analysis, projectId: 'other' }, lines())).toThrow(/different/);
    expect(() => validateQuoteAgainstAnalysis({ ...project, scopeVersion: 2 }, analysis, lines())).toThrow(/changed/);
  });
  it('blocks unresolved clarification and charges for included items', () => {
    const { project, analysis } = setup();
    analysis.items[0].classification = 'clarify';
    expect(() => validateQuoteAgainstAnalysis(project, analysis, lines())).toThrow(/clarification/);
    analysis.items[0].classification = 'included';
    expect(() => validateQuoteAgainstAnalysis(project, analysis, lines())).toThrow(/additional/);
  });
  it('blocks invented rate and scope references', () => {
    const { project, analysis } = setup();
    analysis.items[0].rateId = 'invented';
    expect(() => validateQuoteAgainstAnalysis(project, analysis, lines())).toThrow(/rate/);
    analysis.items[0].rateId = 'extra-slide';
    analysis.items[0].scopeItemId = 'invented';
    expect(() => validateQuoteAgainstAnalysis(project, analysis, lines())).toThrow(/no longer exists/);
  });
});
