import { randomUUID } from 'node:crypto';
import type { Project, Workspace } from '../shared/types.js';

export function createSeedWorkspace(): Workspace {
  const createdAt = new Date().toISOString();
  const project: Project = {
    id: randomUUID(),
    title: 'Juniper investor pitch',
    clientName: 'Juniper Studio',
    clientEmail: 'hello@juniper.example',
    brief: 'Create a 12-slide English pitch deck for Juniper Studio. The fixed project fee is A$600. Delivery is in English only; translated versions are not included. The scope includes one round of revisions to the existing slides, including title and wording changes. Additional slides are outside this agreement.',
    currency: 'AUD',
    baseAmountCents: 60_000,
    revisionAllowance: 1,
    scopeStatus: 'confirmed',
    scopeVersion: 1,
    rateCard: [
      { id: 'extra-slide', label: 'Additional slide', unit: 'slide', unitPriceCents: 4_500 },
      { id: 'translation', label: 'Chinese version', unit: 'version', unitPriceCents: 18_000 },
      { id: 'revision', label: 'Additional revision round', unit: 'round', unitPriceCents: 9_000 },
    ],
    scope: [
      { id: 'scope-deck', label: '12-slide pitch deck', detail: 'One English pitch deck with 12 slides. Additional slides are outside this agreement.', quantity: 12, unit: 'slides', sourceQuote: 'Create a 12-slide English pitch deck for Juniper Studio.' },
      { id: 'scope-language', label: 'English-only delivery', detail: 'The original delivery is in English. Translated versions are additional work.', quantity: 1, unit: 'language', sourceQuote: 'Delivery is in English only; translated versions are not included.' },
      { id: 'scope-revisions', label: 'One revision round', detail: 'One round of revisions to the existing slides, including title and wording changes.', quantity: 1, unit: 'round', sourceQuote: 'The scope includes one round of revisions to the existing slides, including title and wording changes.' },
    ],
    createdAt,
  };
  return {
    projects: [project], analyses: [], quotes: [], invoices: [],
    activity: [{ id: randomUUID(), projectId: project.id, kind: 'scope.confirmed', title: 'Example agreement ready', detail: 'Fictional client and confirmed example scope. The A$600 base fee is a reference amount; no payment has been recorded.', createdAt }],
  };
}
