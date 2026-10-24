import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../server/store.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const START = Date.parse('2026-10-24T00:00:00Z');

describe('persistent rolling request allowances', () => {
  let store: Store;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    store = new Store(':memory:');
  });
  afterEach(() => { store.close(); vi.useRealTimers(); });

  it('preserves a 24-hour allowance when an hourly allowance is consumed and cleaned up', () => {
    expect(store.consume('$global', 'ai', 2, DAY)).toBe(true);
    expect(store.consume('$global', 'ai', 2, DAY)).toBe(true);
    expect(store.consume('$global', 'ai', 2, DAY)).toBe(false);

    vi.setSystemTime(START + HOUR + 1);
    expect(store.consume(store.create().id, 'ai', 30)).toBe(true);
    expect(store.consume('$global', 'ai', 2, DAY)).toBe(false);

    vi.setSystemTime(START + DAY - 1);
    expect(store.consume('$global', 'ai', 2, DAY)).toBe(false);
    vi.setSystemTime(START + DAY + 1);
    expect(store.consume('$global', 'ai', 2, DAY)).toBe(true);
  });

  it('shares the global allowance across workspaces, including a newly created workspace', () => {
    const first = store.create();
    const second = store.create();
    const attempt = (workspaceId: string) => store.consume(workspaceId, 'invoice', 10)
      && store.consume('$global', 'invoice', 2, DAY);
    expect(attempt(first.id)).toBe(true);
    expect(attempt(second.id)).toBe(true);
    expect(attempt(store.create().id)).toBe(false);
  });
});
