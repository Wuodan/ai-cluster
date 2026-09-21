import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { AttemptOutcome, QuotaEvidence } from "./resource.js";
import type { ResourceState, ResourceStateRecord } from "./resource-state.js";

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

export interface StateTransitionRecord {
  readonly resourceKey: string;
  readonly previousState?: ResourceState;
  readonly state: ResourceState;
  readonly observedAtMs: number;
  readonly retryAtMs?: number;
  readonly reason: string;
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

  async getResourceState(resourceKey: string): Promise<ResourceStateRecord | undefined> {
    const row = this.#database
      .prepare("SELECT * FROM resource_states WHERE resource_key = ?")
      .get(resourceKey) as Record<string, unknown> | undefined;
    return row === undefined ? undefined : this.#toResourceState(row);
  }

  async setResourceState(state: ResourceStateRecord): Promise<void> {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const previousRow = this.#database
        .prepare("SELECT * FROM resource_states WHERE resource_key = ?")
        .get(state.resourceKey) as Record<string, unknown> | undefined;
      const previous = previousRow === undefined ? undefined : this.#toResourceState(previousRow);
      const transitionSequence = previousRow === undefined
        ? 1
        : (previousRow.last_transition_sequence as number) + 1;
      this.#database
        .prepare(`
          INSERT INTO resource_states (
            resource_key, source_id, model, state, retry_at_ms,
            consecutive_failures, observed_at_ms, reason, last_transition_sequence
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (resource_key) DO UPDATE SET
            source_id = excluded.source_id,
            model = excluded.model,
            state = excluded.state,
            retry_at_ms = excluded.retry_at_ms,
            consecutive_failures = excluded.consecutive_failures,
            observed_at_ms = excluded.observed_at_ms,
            reason = excluded.reason,
            last_transition_sequence = excluded.last_transition_sequence
        `)
        .run(
          state.resourceKey,
          state.sourceId,
          state.model,
          state.state,
          state.retryAtMs ?? null,
          state.consecutiveFailures,
          state.observedAtMs,
          state.reason,
          transitionSequence,
        );
      this.#database
        .prepare(`
          INSERT INTO state_transitions (
            id, resource_key, sequence, previous_state, state, observed_at_ms, retry_at_ms, reason
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          randomUUID(),
          state.resourceKey,
          transitionSequence,
          previous?.state ?? null,
          state.state,
          state.observedAtMs,
          state.retryAtMs ?? null,
          state.reason,
        );
      this.#database.exec("COMMIT");
    } catch (error: unknown) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  async listStateTransitions(resourceKey: string): Promise<readonly StateTransitionRecord[]> {
    const rows = this.#database
      .prepare("SELECT * FROM state_transitions WHERE resource_key = ? ORDER BY sequence")
      .all(resourceKey) as Record<string, unknown>[];
    return rows.map((row) => ({
      resourceKey: row.resource_key as string,
      ...(row.previous_state === null ? {} : { previousState: row.previous_state as ResourceState }),
      state: row.state as ResourceState,
      observedAtMs: row.observed_at_ms as number,
      ...(row.retry_at_ms === null ? {} : { retryAtMs: row.retry_at_ms as number }),
      reason: row.reason as string,
    }));
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

      CREATE TABLE IF NOT EXISTS resource_states (
        resource_key TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        model TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN (
          'unknown', 'available', 'degraded', 'exhausted', 'cooling_down', 'disabled'
        )),
        retry_at_ms INTEGER,
        consecutive_failures INTEGER NOT NULL CHECK (consecutive_failures >= 0),
        observed_at_ms INTEGER NOT NULL,
        reason TEXT NOT NULL,
        last_transition_sequence INTEGER NOT NULL CHECK (last_transition_sequence > 0)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS state_transitions (
        id TEXT PRIMARY KEY,
        resource_key TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        previous_state TEXT,
        state TEXT NOT NULL CHECK (state IN (
          'unknown', 'available', 'degraded', 'exhausted', 'cooling_down', 'disabled'
        )),
        observed_at_ms INTEGER NOT NULL,
        retry_at_ms INTEGER,
        reason TEXT NOT NULL,
        UNIQUE (resource_key, sequence)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS transitions_resource_time
        ON state_transitions (resource_key, observed_at_ms);

      INSERT OR IGNORE INTO schema_migrations (version) VALUES (1);
      INSERT OR IGNORE INTO schema_migrations (version) VALUES (2);
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

  #toResourceState(row: Record<string, unknown>): ResourceStateRecord {
    return {
      resourceKey: row.resource_key as string,
      sourceId: row.source_id as string,
      model: row.model as string,
      state: row.state as ResourceState,
      ...(row.retry_at_ms === null ? {} : { retryAtMs: row.retry_at_ms as number }),
      consecutiveFailures: row.consecutive_failures as number,
      observedAtMs: row.observed_at_ms as number,
      reason: row.reason as string,
    };
  }
}
