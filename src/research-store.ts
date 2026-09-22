import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  QualificationObservation,
  ResearchCandidate,
  ResearchProposal,
} from "./research.js";

export interface ResearchRunRecord {
  readonly id: string;
  readonly provider: string;
  readonly url: string;
  readonly documentSha256?: string;
  readonly documentContent?: string;
  readonly contentType?: string;
  readonly outcome: "persisted" | "fetch_failed" | "inference_failed" | "invalid_proposal";
  readonly serviceRequestId?: string;
  readonly serviceSourceId?: string;
  readonly serviceModel?: string;
  readonly serviceResolvedModel?: string;
  readonly rawOutput?: string;
  readonly proposal?: ResearchProposal;
  readonly error?: string;
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
}

export interface ResearchCandidateRecord {
  readonly id: string;
  readonly runId: string;
  readonly sequence: number;
  readonly candidate: ResearchCandidate;
  readonly trust: "untrusted";
}

export interface QualificationRecord {
  readonly id: string;
  readonly candidateId: string;
  readonly adapterId: string;
  readonly status: "qualified" | "rejected" | "incomplete" | "manual_action_required";
  readonly observations: readonly QualificationObservation[];
  readonly reason: string;
  readonly observedAtMs: number;
}

export class ResearchStore {
  readonly #database: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.#database = new DatabaseSync(path);
    this.#database.exec("PRAGMA journal_mode = WAL");
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#migrate();
  }

  close(): void {
    this.#database.close();
  }

  async recordRun(run: ResearchRunRecord): Promise<void> {
    this.#insertRun(run);
  }

  async recordCompletedRun(options: {
    readonly run: ResearchRunRecord;
    readonly candidates: readonly ResearchCandidateRecord[];
    readonly qualifications: readonly QualificationRecord[];
  }): Promise<void> {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#insertRun(options.run);
      for (const item of options.candidates) {
        this.#database.prepare(`
          INSERT INTO research_candidates (
            id, run_id, sequence, provider, access_path, claims_json,
            manual_blockers_json, qualification_steps_json, trust
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          item.id,
          item.runId,
          item.sequence,
          item.candidate.provider,
          item.candidate.accessPath,
          JSON.stringify(item.candidate.claims),
          JSON.stringify(item.candidate.manualBlockers),
          JSON.stringify(item.candidate.qualificationSteps),
          item.trust,
        );
      }
      for (const item of options.qualifications) {
        this.#database.prepare(`
          INSERT INTO qualification_attempts (
            id, candidate_id, adapter_id, status, observations_json, reason, observed_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          item.id,
          item.candidateId,
          item.adapterId,
          item.status,
          JSON.stringify(item.observations),
          item.reason,
          item.observedAtMs,
        );
      }
      this.#database.exec("COMMIT");
    } catch (error: unknown) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  async listRuns(): Promise<readonly ResearchRunRecord[]> {
    const rows = this.#database.prepare("SELECT * FROM research_runs ORDER BY started_at_ms, id").all() as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id as string,
      provider: row.provider as string,
      url: row.url as string,
      ...(row.document_sha256 === null ? {} : { documentSha256: row.document_sha256 as string }),
      ...(row.document_content === null ? {} : { documentContent: row.document_content as string }),
      ...(row.content_type === null ? {} : { contentType: row.content_type as string }),
      outcome: row.outcome as ResearchRunRecord["outcome"],
      ...(row.service_request_id === null ? {} : { serviceRequestId: row.service_request_id as string }),
      ...(row.service_source_id === null ? {} : { serviceSourceId: row.service_source_id as string }),
      ...(row.service_model === null ? {} : { serviceModel: row.service_model as string }),
      ...(row.service_resolved_model === null ? {} : { serviceResolvedModel: row.service_resolved_model as string }),
      ...(row.raw_output === null ? {} : { rawOutput: row.raw_output as string }),
      ...(row.proposal_json === null ? {} : { proposal: JSON.parse(row.proposal_json as string) as ResearchProposal }),
      ...(row.error === null ? {} : { error: row.error as string }),
      startedAtMs: row.started_at_ms as number,
      finishedAtMs: row.finished_at_ms as number,
    }));
  }

  async listCandidates(): Promise<readonly ResearchCandidateRecord[]> {
    const rows = this.#database.prepare("SELECT * FROM research_candidates ORDER BY run_id, sequence").all() as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id as string,
      runId: row.run_id as string,
      sequence: row.sequence as number,
      candidate: {
        provider: row.provider as string,
        accessPath: row.access_path as string,
        claims: JSON.parse(row.claims_json as string) as ResearchCandidate["claims"],
        manualBlockers: JSON.parse(row.manual_blockers_json as string) as ResearchCandidate["manualBlockers"],
        qualificationSteps: JSON.parse(row.qualification_steps_json as string) as ResearchCandidate["qualificationSteps"],
      },
      trust: row.trust as "untrusted",
    }));
  }

  async listQualifications(): Promise<readonly QualificationRecord[]> {
    const rows = this.#database.prepare("SELECT * FROM qualification_attempts ORDER BY observed_at_ms, id").all() as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id as string,
      candidateId: row.candidate_id as string,
      adapterId: row.adapter_id as string,
      status: row.status as QualificationRecord["status"],
      observations: JSON.parse(row.observations_json as string) as QualificationObservation[],
      reason: row.reason as string,
      observedAtMs: row.observed_at_ms as number,
    }));
  }

  #insertRun(run: ResearchRunRecord): void {
    this.#database.prepare(`
      INSERT INTO research_runs (
        id, provider, url, document_sha256, document_content, content_type,
        outcome, service_request_id, service_source_id, service_model,
        service_resolved_model, raw_output, proposal_json, error,
        started_at_ms, finished_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      run.id,
      run.provider,
      run.url,
      run.documentSha256 ?? null,
      run.documentContent ?? null,
      run.contentType ?? null,
      run.outcome,
      run.serviceRequestId ?? null,
      run.serviceSourceId ?? null,
      run.serviceModel ?? null,
      run.serviceResolvedModel ?? null,
      run.rawOutput ?? null,
      run.proposal === undefined ? null : JSON.stringify(run.proposal),
      run.error ?? null,
      run.startedAtMs,
      run.finishedAtMs,
    );
  }

  #migrate(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS research_schema_migrations (
        version INTEGER PRIMARY KEY
      ) STRICT;

      CREATE TABLE IF NOT EXISTS research_runs (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        url TEXT NOT NULL,
        document_sha256 TEXT,
        document_content TEXT,
        content_type TEXT,
        outcome TEXT NOT NULL CHECK (outcome IN (
          'persisted', 'fetch_failed', 'inference_failed', 'invalid_proposal'
        )),
        service_request_id TEXT,
        service_source_id TEXT,
        service_model TEXT,
        service_resolved_model TEXT,
        raw_output TEXT,
        proposal_json TEXT,
        error TEXT,
        started_at_ms INTEGER NOT NULL,
        finished_at_ms INTEGER NOT NULL CHECK (finished_at_ms >= started_at_ms)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS research_candidates (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES research_runs(id),
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        provider TEXT NOT NULL,
        access_path TEXT NOT NULL,
        claims_json TEXT NOT NULL,
        manual_blockers_json TEXT NOT NULL,
        qualification_steps_json TEXT NOT NULL,
        trust TEXT NOT NULL CHECK (trust = 'untrusted'),
        UNIQUE (run_id, sequence)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS qualification_attempts (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL REFERENCES research_candidates(id),
        adapter_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN (
          'qualified', 'rejected', 'incomplete', 'manual_action_required'
        )),
        observations_json TEXT NOT NULL,
        reason TEXT NOT NULL,
        observed_at_ms INTEGER NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS research_runs_time ON research_runs (started_at_ms DESC);
      CREATE INDEX IF NOT EXISTS qualification_candidate_time
        ON qualification_attempts (candidate_id, observed_at_ms DESC);
      INSERT OR IGNORE INTO research_schema_migrations (version) VALUES (1);
    `);
  }
}
