import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Workspace } from '../shared/types.js';
import { createSeedWorkspace } from './seed.js';

export interface WorkspaceRecord { id: string; csrf: string; workspace: Workspace }

/** One visitor owns one workspace. SQLite persists data across process restarts. */
export class Store {
  readonly db: DatabaseSync;
  private locks = new Map<string, Promise<void>>();
  constructor(path = process.env.DATABASE_PATH || 'data/scopepay.sqlite') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, csrf TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS review_links (token TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, quote_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS invoice_refs (external_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, invoice_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS webhook_events (event_id TEXT PRIMARY KEY, processed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations (operation_key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS usage (workspace_id TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS usage_lookup ON usage(workspace_id, kind, created_at);`);
  }
  get(id: string): WorkspaceRecord | undefined {
    const row = this.db.prepare('SELECT id, csrf, data FROM workspaces WHERE id=?').get(id) as { id: string; csrf: string; data: string } | undefined;
    return row ? { id: row.id, csrf: row.csrf, workspace: JSON.parse(row.data) as Workspace } : undefined;
  }
  create(): WorkspaceRecord {
    const record = { id: randomBytes(32).toString('base64url'), csrf: randomBytes(32).toString('base64url'), workspace: createSeedWorkspace() };
    this.db.prepare('INSERT INTO workspaces (id, csrf, data, updated_at) VALUES (?,?,?,?)').run(record.id, record.csrf, JSON.stringify(record.workspace), new Date().toISOString());
    return record;
  }
  save(record: WorkspaceRecord): void {
    record.workspace.activity = record.workspace.activity.slice(0, 100);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE workspaces SET data=?, updated_at=? WHERE id=?').run(JSON.stringify(record.workspace), new Date().toISOString(), record.id);
      for (const quote of record.workspace.quotes) {
        if (quote.shareToken) this.db.prepare('INSERT OR IGNORE INTO review_links VALUES (?,?,?)').run(quote.shareToken, record.id, quote.id);
      }
      for (const invoice of record.workspace.invoices) {
        if (invoice.provider === 'paypal-sandbox') this.db.prepare('INSERT OR IGNORE INTO invoice_refs VALUES (?,?,?)').run(invoice.externalId, record.id, invoice.id);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  findReview(token: string): { workspaceId: string; quoteId: string } | undefined {
    const row = this.db.prepare('SELECT workspace_id, quote_id FROM review_links WHERE token=?').get(token) as { workspace_id: string; quote_id: string } | undefined;
    return row ? { workspaceId: row.workspace_id, quoteId: row.quote_id } : undefined;
  }
  findInvoice(externalId: string): { workspaceId: string; invoiceId: string } | undefined {
    const row = this.db.prepare('SELECT workspace_id, invoice_id FROM invoice_refs WHERE external_id=?').get(externalId) as { workspace_id: string; invoice_id: string } | undefined;
    return row ? { workspaceId: row.workspace_id, invoiceId: row.invoice_id } : undefined;
  }
  reset(record: WorkspaceRecord): void {
    this.db.prepare('DELETE FROM review_links WHERE workspace_id=?').run(record.id);
    this.db.prepare('DELETE FROM invoice_refs WHERE workspace_id=?').run(record.id);
    record.workspace = createSeedWorkspace();
    this.save(record);
  }
  operation(key: string, value: string): string {
    this.db.prepare('INSERT OR IGNORE INTO operations VALUES (?,?)').run(key, value);
    return (this.db.prepare('SELECT value FROM operations WHERE operation_key=?').get(key) as { value: string }).value;
  }
  hasEvent(id: string): boolean { return Boolean(this.db.prepare('SELECT 1 FROM webhook_events WHERE event_id=?').get(id)); }
  markEvent(id: string): void { this.db.prepare('INSERT OR IGNORE INTO webhook_events VALUES (?,?)').run(id, new Date().toISOString()); }
  consume(id: string, kind: string, limit: number, windowMs = 3_600_000): boolean {
    const since = Date.now() - windowMs;
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM usage WHERE workspace_id=? AND kind=? AND created_at>?').get(id, kind, since) as { count: number };
    if (row.count >= limit) return false;
    this.db.prepare('INSERT INTO usage VALUES (?,?,?)').run(id, kind, Date.now());
    this.db.prepare('DELETE FROM usage WHERE created_at<?').run(Date.now() - 7 * 86_400_000);
    return true;
  }
  /** Serialises async changes to a workspace so simultaneous tabs cannot lose updates. */
  async locked<T>(id: string, action: (record: WorkspaceRecord) => Promise<T> | T): Promise<T> {
    const previous = this.locks.get(id) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    this.locks.set(id, current);
    await previous;
    try {
      const record = this.get(id);
      if (!record) throw new Error('This workspace is no longer available. Reload the page.');
      return await action(record);
    } finally { release(); if (this.locks.get(id) === current) this.locks.delete(id); }
  }
  close(): void { this.db.close(); }
}
