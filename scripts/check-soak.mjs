import { DatabaseSync } from "node:sqlite";

const dayMs = 24 * 60 * 60 * 1_000;
const databasePath = process.env.AI_CLUSTER_DATABASE_PATH ?? "data/resource-loop.sqlite";
const baseUrl = process.env.AI_CLUSTER_BASE_URL ?? "http://127.0.0.1:8787";
const expectedResources = new Set([
  "openrouter:openrouter/free",
  "groq:openai/gpt-oss-120b",
  "gemini:gemini-3.6-flash",
  "local-llama:qwen3-4b-q4_k_m",
]);

const checks = [];
let status;
let audit;

try {
  const healthResponse = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(5_000) });
  const health = await healthResponse.json();
  addCheck(
    "host HTTP health",
    healthResponse.ok && health.status === "ok",
    healthResponse.ok ? `reported ${String(health.status)}` : `returned HTTP ${healthResponse.status}`,
  );
  status = await fetchJson("/v1/status");
  audit = await fetchJson("/v1/audit");
} catch (error) {
  addCheck("host HTTP health", false, error instanceof Error ? error.message : String(error));
}

if (status !== undefined) {
  const resources = Array.isArray(status.resources) ? status.resources : [];
  const byKey = new Map(resources.map((resource) => [resource.resourceKey, resource]));
  const missing = [...expectedResources].filter((key) => !byKey.has(key));
  const unexpected = [...byKey.keys()].filter((key) => !expectedResources.has(key));
  addCheck(
    "configured pool",
    missing.length === 0 && unexpected.length === 0,
    missing.length === 0 && unexpected.length === 0
      ? `${expectedResources.size} expected resources`
      : `missing=${missing.join(",") || "none"} unexpected=${unexpected.join(",") || "none"}`,
  );

  const disallowed = resources.filter((resource) => resource.allowed !== true).map((resource) => resource.resourceKey);
  addCheck(
    "configured allowlist",
    disallowed.length === 0,
    disallowed.length === 0 ? "every configured resource is allowed" : `disallowed=${disallowed.join(",")}`,
  );

  const unavailable = resources
    .filter((resource) => resource.state?.state !== "available")
    .map((resource) => `${resource.resourceKey}:${String(resource.state?.state ?? "missing")}`);
  addCheck(
    "current availability",
    unavailable.length === 0,
    unavailable.length === 0 ? "every configured resource is available" : unavailable.join(", "),
  );

  const withoutEvidence = resources
    .filter((resource) => !Array.isArray(resource.capabilities) || resource.capabilities.length === 0)
    .map((resource) => resource.resourceKey);
  addCheck(
    "current capability evidence",
    withoutEvidence.length === 0,
    withoutEvidence.length === 0 ? "every configured resource has observed evidence" : `missing=${withoutEvidence.join(",")}`,
  );
}

if (audit !== undefined) {
  const violations = Array.isArray(audit.selectionViolations) ? audit.selectionViolations.length : -1;
  addCheck(
    "zero-spend selection audit",
    audit.assessment === "no_paid_path_selected" && audit.paidInferenceAllowed === false && violations === 0,
    `assessment=${String(audit.assessment)} paidInferenceAllowed=${String(audit.paidInferenceAllowed)} violations=${violations}`,
  );
}

let database;
try {
  database = new DatabaseSync(databasePath, { readOnly: true });
  const maintenance = database.prepare(`
    select count(*) as count,
           min(started_at_ms) as first_ms,
           max(finished_at_ms) as last_ms,
           sum(outcome = 'failed') as failures
      from maintenance_runs
  `).get();
  const spanMs = numberOrZero(maintenance.last_ms) - numberOrZero(maintenance.first_ms);
  addCheck(
    "persisted soak span",
    spanMs >= dayMs,
    `${formatDuration(spanMs)} across ${numberOrZero(maintenance.count)} maintenance runs; first=${formatTime(maintenance.first_ms)} last=${formatTime(maintenance.last_ms)}`,
  );

  const latestRuns = database.prepare(`
    select run.kind, run.outcome, run.summary, run.started_at_ms
      from maintenance_runs run
      join (
        select kind, target, max(started_at_ms) as started_at_ms
          from maintenance_runs
         group by kind, target
      ) latest
        on latest.kind = run.kind
       and latest.target = run.target
       and latest.started_at_ms = run.started_at_ms
     order by run.kind
  `).all();
  const failedLatest = latestRuns.filter((run) => run.outcome === "failed");
  addCheck(
    "latest maintenance outcomes",
    failedLatest.length === 0,
    latestRuns.map((run) => `${run.kind}=${run.outcome}(${run.summary})`).join(", ") || "no runs",
  );

  const geminiState = database.prepare(`
    select state, observed_at_ms
      from resource_states
     where resource_key = 'gemini:gemini-3.6-flash'
  `).get();
  const evaluationAfterGemini = geminiState === undefined ? undefined : database.prepare(`
    select started_at_ms, finished_at_ms, summary
      from maintenance_runs
     where kind = 'capability_evaluation'
       and target = 'configured_pool'
       and outcome = 'success'
       and started_at_ms >= ?
     order by started_at_ms desc
     limit 1
  `).get(geminiState.observed_at_ms);
  addCheck(
    "daily evaluation after Gemini observation",
    geminiState?.state === "available" && evaluationAfterGemini !== undefined,
    geminiState === undefined
      ? "Gemini has not yet been probed"
      : evaluationAfterGemini === undefined
        ? `Gemini became ${String(geminiState.state)} at ${formatTime(geminiState.observed_at_ms)}; waiting for the next normal capability evaluation`
        : `${evaluationAfterGemini.summary} at ${formatTime(evaluationAfterGemini.finished_at_ms)}`,
  );

  const recoveredFailures = database.prepare(`
    select count(*) as count
      from state_transitions failure
     where failure.state in ('degraded', 'exhausted', 'cooling_down')
       and exists (
         select 1
           from state_transitions recovery
          where recovery.resource_key = failure.resource_key
            and recovery.state = 'available'
            and recovery.observed_at_ms > failure.observed_at_ms
       )
  `).get();
  addCheck(
    "persisted failure and recovery",
    numberOrZero(recoveredFailures.count) > 0,
    `${numberOrZero(recoveredFailures.count)} recoverable failure transition(s) later returned to available`,
  );

  const evidence = database.prepare(`
    select
      (select count(*) from attempts) as attempts,
      (select count(*) from state_transitions) as transitions,
      (select count(*) from catalog_snapshots) as catalog_snapshots,
      (select count(*) from capability_evidence) as capability_evidence
  `).get();
  process.stdout.write(
    `Evidence: attempts=${numberOrZero(evidence.attempts)} transitions=${numberOrZero(evidence.transitions)} catalogSnapshots=${numberOrZero(evidence.catalog_snapshots)} capabilityEvidence=${numberOrZero(evidence.capability_evidence)} historicalMaintenanceFailures=${numberOrZero(maintenance.failures)}\n`,
  );
} catch (error) {
  addCheck("persisted soak database", false, error instanceof Error ? error.message : String(error));
} finally {
  database?.close();
}

for (const check of checks) {
  process.stdout.write(`${check.passed ? "PASS" : "WAIT"}  ${check.name}: ${check.detail}\n`);
}

const ready = checks.length > 0 && checks.every((check) => check.passed);
process.stdout.write(`\nMilestone 6 soak readiness: ${ready ? "READY FOR REVIEW" : "NOT READY"}\n`);
process.exitCode = ready ? 0 : 1;

async function fetchJson(path) {
  const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
}

function addCheck(name, passed, detail) {
  checks.push({ name, passed, detail });
}

function numberOrZero(value) {
  return typeof value === "number" ? value : 0;
}

function formatDuration(value) {
  const hours = value / (60 * 60 * 1_000);
  return `${hours.toFixed(1)}h`;
}

function formatTime(value) {
  return typeof value === "number" ? new Date(value).toISOString() : "unknown";
}
