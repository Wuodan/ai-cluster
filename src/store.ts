import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { CapabilityEvidence, EvidenceKind } from "./capability.js";
import type { CatalogEntry, CatalogStatus } from "./catalog.js";
import type { AttemptOutcome, Capability, QuotaEvidence, ResourceRequirements } from "./resource.js";
import type { RecoveryProposal } from "./recovery.js";
import type { ResourceState, ResourceStateRecord } from "./resource-state.js";

export interface AttemptRecord {
  readonly requestId: string;
  readonly attemptNumber: number;
  readonly sourceId: string;
  readonly model: string;
  readonly resolvedModel?: string;
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

export interface CatalogModelRecord extends CatalogEntry {
  readonly sourceId: string;
  readonly status: CatalogStatus;
  readonly firstSeenAtMs: number;
  readonly lastSeenAtMs: number;
  readonly statusReason: string;
}

export interface StoredCapabilityEvidence extends CapabilityEvidence {
  readonly id: string;
  readonly sequence: number;
  readonly resourceKey: string;
}

export interface RecoveryFindingRecord {
  readonly sourceId: string;
  readonly model: string;
  readonly observations: string;
  readonly rawOutput: string;
  readonly proposal?: RecoveryProposal;
  readonly parseStatus: "valid" | "invalid" | "inference_failed";
  readonly observedAtMs: number;
}

export interface StoredRecoveryFinding extends RecoveryFindingRecord {
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
          resolved_model, error_code, error_message, quota_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        attempt.resolvedModel ?? null,
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

  async listRecentAttempts(limit: number): Promise<readonly StoredAttempt[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new Error("Invalid attempt limit");
    const rows = this.#database.prepare(`
      SELECT * FROM attempts ORDER BY started_at_ms DESC, attempt_number DESC LIMIT ?
    `).all(limit);
    return rows.map((row) => this.#toStoredAttempt(row as Record<string, unknown>));
  }

  async getResourceState(resourceKey: string): Promise<ResourceStateRecord | undefined> {
    const row = this.#database
      .prepare("SELECT * FROM resource_states WHERE resource_key = ?")
      .get(resourceKey) as Record<string, unknown> | undefined;
    return row === undefined ? undefined : this.#toResourceState(row);
  }

  async listResourceStates(): Promise<readonly ResourceStateRecord[]> {
    const rows = this.#database.prepare(`
      SELECT * FROM resource_states ORDER BY source_id, model
    `).all() as Record<string, unknown>[];
    return rows.map((row) => this.#toResourceState(row));
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

  async applyCatalogSnapshot(
    sourceId: string,
    entries: readonly CatalogEntry[],
    observedAtMs: number,
  ): Promise<void> {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const existingRows = this.#database
        .prepare("SELECT * FROM catalog_models WHERE source_id = ?")
        .all(sourceId) as Record<string, unknown>[];
      const existing = new Map(existingRows.map((row) => [row.model_id as string, row]));
      const seen = new Set<string>();

      for (const entry of entries) {
        if (seen.has(entry.modelId)) throw new Error(`Duplicate catalog model: ${entry.modelId}`);
        seen.add(entry.modelId);
        const previous = existing.get(entry.modelId);
        const previousStatus = previous?.status as CatalogStatus | undefined;
        const previousZeroCost = previous === undefined ? undefined : (previous.zero_cost as number) === 1;
        const status = catalogStatusAfterObservation(previousStatus, previousZeroCost, entry.zeroCost);
        const reason = catalogReason(previousStatus, previousZeroCost, entry.zeroCost);

        this.#database.prepare(`
          INSERT INTO catalog_models (
            source_id, model_id, zero_cost, status, first_seen_at_ms,
            last_seen_at_ms, status_reason, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (source_id, model_id) DO UPDATE SET
            zero_cost = excluded.zero_cost,
            status = excluded.status,
            last_seen_at_ms = excluded.last_seen_at_ms,
            status_reason = excluded.status_reason,
            metadata_json = excluded.metadata_json
        `).run(
          sourceId,
          entry.modelId,
          entry.zeroCost ? 1 : 0,
          status,
          previous === undefined ? observedAtMs : previous.first_seen_at_ms as number,
          observedAtMs,
          reason,
          JSON.stringify(entry.metadata),
        );

        if (previous === undefined || previousStatus !== status || previousZeroCost !== entry.zeroCost) {
          this.#insertCatalogEvent(sourceId, entry.modelId, status, reason, observedAtMs);
        }
      }

      for (const [modelId, previous] of existing) {
        if (seen.has(modelId) || previous.status === "unavailable") continue;
        this.#database.prepare(`
          UPDATE catalog_models
          SET status = 'unavailable', status_reason = 'absent_from_catalog'
          WHERE source_id = ? AND model_id = ?
        `).run(sourceId, modelId);
        this.#insertCatalogEvent(sourceId, modelId, "unavailable", "absent_from_catalog", observedAtMs);
      }

      this.#database.prepare(`
        INSERT INTO catalog_snapshots (id, source_id, observed_at_ms, model_count)
        VALUES (?, ?, ?, ?)
      `).run(randomUUID(), sourceId, observedAtMs, entries.length);
      this.#database.exec("COMMIT");
    } catch (error: unknown) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  async qualifyCatalogModel(sourceId: string, modelId: string, observedAtMs: number): Promise<void> {
    const result = this.#database.prepare(`
      UPDATE catalog_models
      SET status = 'qualified', status_reason = 'probe_succeeded', last_seen_at_ms = ?
      WHERE source_id = ? AND model_id = ? AND zero_cost = 1 AND status = 'quarantined'
    `).run(observedAtMs, sourceId, modelId);
    if (result.changes !== 1) throw new Error(`Catalog model is not eligible for qualification: ${sourceId}:${modelId}`);
    this.#insertCatalogEvent(sourceId, modelId, "qualified", "probe_succeeded", observedAtMs);
  }

  async listCatalogModels(sourceId: string): Promise<readonly CatalogModelRecord[]> {
    const rows = this.#database
      .prepare("SELECT * FROM catalog_models WHERE source_id = ? ORDER BY model_id")
      .all(sourceId) as Record<string, unknown>[];
    return rows.map((row) => ({
      sourceId: row.source_id as string,
      modelId: row.model_id as string,
      zeroCost: (row.zero_cost as number) === 1,
      status: row.status as CatalogStatus,
      firstSeenAtMs: row.first_seen_at_ms as number,
      lastSeenAtMs: row.last_seen_at_ms as number,
      statusReason: row.status_reason as string,
      metadata: JSON.parse(row.metadata_json as string) as Readonly<Record<string, unknown>>,
    }));
  }

  async listSelectableCatalogModels(sourceId: string): Promise<readonly CatalogModelRecord[]> {
    return (await this.listCatalogModels(sourceId)).filter(
      (model) => model.zeroCost && model.status === "qualified",
    );
  }

  async recordCapabilityEvidence(evidence: CapabilityEvidence): Promise<string> {
    const id = randomUUID();
    const resourceKey = `${evidence.sourceId}:${evidence.model}`;
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const latest = this.#database.prepare(`
        SELECT MAX(sequence) AS sequence
        FROM capability_evidence
        WHERE resource_key = ? AND capability = ? AND evidence_kind = ?
      `).get(resourceKey, evidence.capability, evidence.evidenceKind) as { sequence: number | null };
      const sequence = (latest.sequence ?? 0) + 1;
      this.#database.prepare(`
        INSERT INTO capability_evidence (
          id, resource_key, sequence, source_id, model, access_path, capability,
          resolved_model, evidence_kind, verdict, numeric_value, evaluator, test_id,
          input_text, output_text, rationale, uncertainty, observed_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        resourceKey,
        sequence,
        evidence.sourceId,
        evidence.model,
        evidence.accessPath,
        evidence.capability,
        evidence.resolvedModel ?? null,
        evidence.evidenceKind,
        evidence.verdict,
        evidence.numericValue ?? null,
        evidence.evaluator,
        evidence.testId,
        evidence.input,
        evidence.output ?? null,
        evidence.rationale,
        evidence.uncertainty ?? null,
        evidence.observedAtMs,
      );
      this.#database.exec("COMMIT");
      return id;
    } catch (error: unknown) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  async listCapabilityEvidence(
    resourceKey: string,
    capability?: Capability,
  ): Promise<readonly StoredCapabilityEvidence[]> {
    const rows = capability === undefined
      ? this.#database.prepare(`
          SELECT * FROM capability_evidence WHERE resource_key = ?
          ORDER BY capability, evidence_kind, sequence
        `).all(resourceKey)
      : this.#database.prepare(`
          SELECT * FROM capability_evidence WHERE resource_key = ? AND capability = ?
          ORDER BY evidence_kind, sequence
        `).all(resourceKey, capability);
    return rows.map((row) => this.#toCapabilityEvidence(row as Record<string, unknown>));
  }

  async listCurrentObservedCapabilityEvidence(resourceKey: string): Promise<readonly StoredCapabilityEvidence[]> {
    const rows = this.#database.prepare(`
      SELECT evidence.*
      FROM capability_evidence AS evidence
      WHERE evidence.resource_key = ?
        AND evidence.evidence_kind = 'observed'
        AND evidence.sequence = (
          SELECT MAX(candidate.sequence)
          FROM capability_evidence AS candidate
          WHERE candidate.resource_key = evidence.resource_key
            AND candidate.capability = evidence.capability
            AND candidate.evidence_kind = evidence.evidence_kind
        )
      ORDER BY evidence.capability
    `).all(resourceKey);
    return rows.map((row) => this.#toCapabilityEvidence(row as Record<string, unknown>));
  }

  async resourceMeetsRequirements(
    resourceKey: string,
    requirements: ResourceRequirements | undefined,
  ): Promise<boolean> {
    if (requirements === undefined) return true;
    for (const capability of requirements.capabilities ?? []) {
      const latest = this.#latestCapabilityEvidence(resourceKey, capability, "observed");
      if (latest?.verdict !== "supported") return false;
    }
    if (requirements.minimumContextTokens !== undefined) {
      const latest = this.#latestCapabilityEvidence(resourceKey, "context_tokens", "observed");
      if (
        latest?.verdict !== "supported"
        || latest.numericValue === undefined
        || latest.numericValue < requirements.minimumContextTokens
      ) return false;
    }
    return true;
  }

  async recordRecoveryFinding(finding: RecoveryFindingRecord): Promise<string> {
    const id = randomUUID();
    this.#database.prepare(`
      INSERT INTO recovery_findings (
        id, source_id, model, observations, raw_output, proposal_json, parse_status, observed_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      finding.sourceId,
      finding.model,
      finding.observations,
      finding.rawOutput,
      finding.proposal === undefined ? null : JSON.stringify(finding.proposal),
      finding.parseStatus,
      finding.observedAtMs,
    );
    return id;
  }

  async listRecoveryFindings(): Promise<readonly StoredRecoveryFinding[]> {
    const rows = this.#database.prepare(`
      SELECT * FROM recovery_findings ORDER BY observed_at_ms, id
    `).all() as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id as string,
      sourceId: row.source_id as string,
      model: row.model as string,
      observations: row.observations as string,
      rawOutput: row.raw_output as string,
      ...(row.proposal_json === null
        ? {}
        : { proposal: JSON.parse(row.proposal_json as string) as RecoveryProposal }),
      parseStatus: row.parse_status as RecoveryFindingRecord["parseStatus"],
      observedAtMs: row.observed_at_ms as number,
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

      CREATE TABLE IF NOT EXISTS catalog_models (
        source_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        zero_cost INTEGER NOT NULL CHECK (zero_cost IN (0, 1)),
        status TEXT NOT NULL CHECK (status IN ('quarantined', 'qualified', 'unavailable', 'rejected')),
        first_seen_at_ms INTEGER NOT NULL,
        last_seen_at_ms INTEGER NOT NULL,
        status_reason TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        PRIMARY KEY (source_id, model_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS catalog_events (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('quarantined', 'qualified', 'unavailable', 'rejected')),
        reason TEXT NOT NULL,
        observed_at_ms INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS catalog_snapshots (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        observed_at_ms INTEGER NOT NULL,
        model_count INTEGER NOT NULL CHECK (model_count >= 0)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS capability_evidence (
        id TEXT PRIMARY KEY,
        resource_key TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        source_id TEXT NOT NULL,
        model TEXT NOT NULL,
        access_path TEXT NOT NULL CHECK (access_path IN ('api', 'process', 'local')),
        capability TEXT NOT NULL CHECK (capability IN (
          'text_generation', 'instruction_following', 'structured_json',
          'tool_use', 'coding', 'context_tokens'
        )),
        resolved_model TEXT,
        evidence_kind TEXT NOT NULL CHECK (evidence_kind IN ('advertised', 'observed')),
        verdict TEXT NOT NULL CHECK (verdict IN ('supported', 'unsupported')),
        numeric_value INTEGER,
        evaluator TEXT NOT NULL CHECK (evaluator IN ('provider_claim', 'deterministic', 'llm')),
        test_id TEXT NOT NULL,
        input_text TEXT NOT NULL,
        output_text TEXT,
        rationale TEXT NOT NULL,
        uncertainty REAL CHECK (uncertainty IS NULL OR (uncertainty >= 0 AND uncertainty <= 1)),
        observed_at_ms INTEGER NOT NULL,
        UNIQUE (resource_key, capability, evidence_kind, sequence)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS capability_evidence_latest
        ON capability_evidence (resource_key, capability, evidence_kind, sequence DESC);

      CREATE TABLE IF NOT EXISTS recovery_findings (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        model TEXT NOT NULL,
        observations TEXT NOT NULL,
        raw_output TEXT NOT NULL,
        proposal_json TEXT,
        parse_status TEXT NOT NULL CHECK (parse_status IN ('valid', 'invalid', 'inference_failed')),
        observed_at_ms INTEGER NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS recovery_findings_time
        ON recovery_findings (observed_at_ms);

      INSERT OR IGNORE INTO schema_migrations (version) VALUES (1);
      INSERT OR IGNORE INTO schema_migrations (version) VALUES (2);
      INSERT OR IGNORE INTO schema_migrations (version) VALUES (3);
      INSERT OR IGNORE INTO schema_migrations (version) VALUES (4);
      INSERT OR IGNORE INTO schema_migrations (version) VALUES (5);
    `);
    const attemptColumns = this.#database.prepare("PRAGMA table_info(attempts)").all() as { name: string }[];
    if (!attemptColumns.some((column) => column.name === "resolved_model")) {
      this.#database.exec("ALTER TABLE attempts ADD COLUMN resolved_model TEXT");
    }
    this.#database.prepare("INSERT OR IGNORE INTO schema_migrations (version) VALUES (6)").run();
  }

  #toStoredAttempt(row: Record<string, unknown>): StoredAttempt {
    const quotaJson = row.quota_json as string | null;

    return {
      id: row.id as string,
      requestId: row.request_id as string,
      attemptNumber: row.attempt_number as number,
      sourceId: row.source_id as string,
      model: row.model as string,
      ...(row.resolved_model === null ? {} : { resolvedModel: row.resolved_model as string }),
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

  #insertCatalogEvent(
    sourceId: string,
    modelId: string,
    status: CatalogStatus,
    reason: string,
    observedAtMs: number,
  ): void {
    this.#database.prepare(`
      INSERT INTO catalog_events (id, source_id, model_id, status, reason, observed_at_ms)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), sourceId, modelId, status, reason, observedAtMs);
  }

  #latestCapabilityEvidence(
    resourceKey: string,
    capability: Capability,
    evidenceKind: EvidenceKind,
  ): StoredCapabilityEvidence | undefined {
    const row = this.#database.prepare(`
      SELECT * FROM capability_evidence
      WHERE resource_key = ? AND capability = ? AND evidence_kind = ?
      ORDER BY sequence DESC LIMIT 1
    `).get(resourceKey, capability, evidenceKind) as Record<string, unknown> | undefined;
    return row === undefined ? undefined : this.#toCapabilityEvidence(row);
  }

  #toCapabilityEvidence(row: Record<string, unknown>): StoredCapabilityEvidence {
    return {
      id: row.id as string,
      sequence: row.sequence as number,
      resourceKey: row.resource_key as string,
      sourceId: row.source_id as string,
      model: row.model as string,
      accessPath: row.access_path as CapabilityEvidence["accessPath"],
      capability: row.capability as Capability,
      evidenceKind: row.evidence_kind as CapabilityEvidence["evidenceKind"],
      verdict: row.verdict as CapabilityEvidence["verdict"],
      ...(row.numeric_value === null ? {} : { numericValue: row.numeric_value as number }),
      evaluator: row.evaluator as CapabilityEvidence["evaluator"],
      testId: row.test_id as string,
      input: row.input_text as string,
      ...(row.output_text === null ? {} : { output: row.output_text as string }),
      rationale: row.rationale as string,
      ...(row.uncertainty === null ? {} : { uncertainty: row.uncertainty as number }),
      observedAtMs: row.observed_at_ms as number,
    };
  }
}

function catalogStatusAfterObservation(
  previousStatus: CatalogStatus | undefined,
  previousZeroCost: boolean | undefined,
  zeroCost: boolean,
): CatalogStatus {
  if (!zeroCost) return "rejected";
  if (previousStatus === "qualified" && previousZeroCost === true) return "qualified";
  if (previousStatus === "quarantined" && previousZeroCost === true) return "quarantined";
  return "quarantined";
}

function catalogReason(
  previousStatus: CatalogStatus | undefined,
  previousZeroCost: boolean | undefined,
  zeroCost: boolean,
): string {
  if (!zeroCost) return "non_zero_price";
  if (previousStatus === undefined) return "new_model";
  if (previousStatus === "unavailable") return "model_reappeared";
  if (previousZeroCost === false) return "price_became_zero";
  return previousStatus === "qualified" ? "qualification_retained" : "awaiting_qualification";
}
