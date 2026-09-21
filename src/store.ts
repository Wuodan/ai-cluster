import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { AttemptOutcome, QuotaEvidence } from "./resource.js";

export interface AttemptRecord {
  readonly requestId: string;
  readonly attemptNumber: number;
  readonly sourceId: string;
  readonly model: string;
  readonly outcome: AttemptOutcome;
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
  readonly latencyMs: number;
  readonly output?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly quota?: QuotaEvidence;
}

export interface StoredAttempt extends AttemptRecord {
  readonly id: string;
}

export class ResourceStore {
  readonly #database: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }

    this.#database = new DatabaseSync(path);
    this.#database.exec("PRAGMA journal_mode = WAL");
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#migrate();
  }

  close(): void {
    this.#database.close();
  }

  async recordAttempt(attempt: AttemptRecord): Promise<string> {
    const id = randomUUID();
    this.#database
      .prepare(`
        INSERT INTO attempts (
          id, request_id, attempt_number, source_id, model, outcome,
          started_at_ms, finished_at_ms, latency_ms, output,
          error_code, error_message, quota_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        attempt.requestId,
        attempt.attemptNumber,
        attempt.sourceId,
        attempt.model,
        attempt.outcome,
        attempt.startedAtMs,
        attempt.finishedAtMs,
        attempt.latencyMs,
        attempt.output ?? null,
        attempt.errorCode ?? null,
        attempt.errorMessage ?? null,
        attempt.quota === undefined ? null : JSON.stringify(attempt.quota),
      );
    return id;
  }

  async listAttempts(requestId?: string): Promise<readonly StoredAttempt[]> {
    const rows = requestId === undefined
      ? this.#database.prepare("SELECT * FROM attempts ORDER BY started_at_ms, attempt_number").all()
      : this.#database
          .prepare("SELECT * FROM attempts WHERE request_id = ? ORDER BY attempt_number")
          .all(requestId);

    return rows.map((row) => this.#toStoredAttempt(row as Record<string, unknown>));
  }

  #migrate(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY
      ) STRICT;

      CREATE TABLE IF NOT EXISTS attempts (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        attempt_number INTEGER NOT NULL,
        source_id TEXT NOT NULL,
        model TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN (
          'success', 'unavailable', 'exhausted', 'rejected',
          'malformed_response', 'unknown_failure'
        )),
        started_at_ms INTEGER NOT NULL,
        finished_at_ms INTEGER NOT NULL,
        latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
        output TEXT,
        error_code TEXT,
        error_message TEXT,
        quota_json TEXT,
        UNIQUE (request_id, attempt_number)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS attempts_source_time
        ON attempts (source_id, started_at_ms DESC);

      INSERT OR IGNORE INTO schema_migrations (version) VALUES (1);
    `);
  }

  #toStoredAttempt(row: Record<string, unknown>): StoredAttempt {
    const quotaJson = row.quota_json as string | null;

    return {
      id: row.id as string,
      requestId: row.request_id as string,
      attemptNumber: row.attempt_number as number,
      sourceId: row.source_id as string,
      model: row.model as string,
      outcome: row.outcome as AttemptOutcome,
      startedAtMs: row.started_at_ms as number,
      finishedAtMs: row.finished_at_ms as number,
      latencyMs: row.latency_ms as number,
      ...(row.output === null ? {} : { output: row.output as string }),
      ...(row.error_code === null ? {} : { errorCode: row.error_code as string }),
      ...(row.error_message === null ? {} : { errorMessage: row.error_message as string }),
      ...(quotaJson === null ? {} : { quota: JSON.parse(quotaJson) as QuotaEvidence }),
    };
  }
}
