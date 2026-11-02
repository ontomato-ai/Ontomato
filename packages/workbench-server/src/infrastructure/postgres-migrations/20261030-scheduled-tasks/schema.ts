import { qualifiedTable as t } from "../../postgres";
import type { QueryableClient } from "../helpers";

/**
 * Scheduled tasks on the agent runtime. A task is one owner's prompt for one agent in one domain; each run starts a
 * new assistant conversation. The owner's background credential is kept once per owner and domain, sealed.
 *
 * The retired analysis_schedule_rules table (rules of the old task runner, holding plaintext login tokens) is dropped
 * without conversion, as decided for this release: its rules are not carried over.
 */
export async function ensureScheduledTaskSchema(c: QueryableClient) {
  await c.query(`DROP TABLE IF EXISTS ${t("analysis_schedule_rules")};
  CREATE TABLE IF NOT EXISTS ${t("scheduled_task_credentials")} (
    domain_id text NOT NULL, owner_id text NOT NULL,
    sealed_key text,
    state text NOT NULL CHECK (state IN ('valid','invalid')),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(domain_id,owner_id));
  CREATE TABLE IF NOT EXISTS ${t("scheduled_tasks")} (
    id uuid PRIMARY KEY, domain_id text NOT NULL, owner_id text NOT NULL, agent_id uuid NOT NULL,
    prompt text NOT NULL, frequency jsonb NOT NULL, notify_email text, locale text NOT NULL,
    enabled boolean NOT NULL DEFAULT true,
    paused_reason text CHECK (paused_reason IN ('credential_invalid','agent_unavailable')),
    next_run_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
  CREATE INDEX IF NOT EXISTS scheduled_tasks_owner ON ${t("scheduled_tasks")}(domain_id,owner_id,created_at DESC,id DESC);
  CREATE INDEX IF NOT EXISTS scheduled_tasks_due ON ${t("scheduled_tasks")}(next_run_at) WHERE enabled AND paused_reason IS NULL;
  CREATE TABLE IF NOT EXISTS ${t("scheduled_task_runs")} (
    id uuid PRIMARY KEY, task_id uuid NOT NULL REFERENCES ${t("scheduled_tasks")}(id) ON DELETE CASCADE,
    session_id uuid, trigger text NOT NULL CHECK (trigger IN ('schedule','manual')),
    status text NOT NULL CHECK (status IN ('running','completed','failed')),
    error_code text, error_message text,
    started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz);
  CREATE INDEX IF NOT EXISTS scheduled_task_runs_task ON ${t("scheduled_task_runs")}(task_id,started_at DESC,id DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS scheduled_task_runs_one_running ON ${t("scheduled_task_runs")}(task_id) WHERE status='running';`);
}
