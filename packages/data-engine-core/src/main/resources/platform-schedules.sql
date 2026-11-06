CREATE TABLE IF NOT EXISTS platform_task (
 id uuid PRIMARY KEY, domain_id text NOT NULL, creator_id text NOT NULL,
 app_id text NOT NULL, title text NOT NULL, content jsonb NOT NULL, form_revision text NOT NULL,
 summary jsonb NOT NULL, revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
 frequency jsonb NOT NULL, time_zone text NOT NULL,
 enabled boolean NOT NULL DEFAULT true, pause_code text, pause_message text, next_run_at timestamptz,
 notify_email text, locale text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (char_length(title) BETWEEN 1 AND 200),
 CHECK (enabled OR (pause_code IS NULL AND next_run_at IS NULL)),
 CHECK (pause_code IS NULL OR next_run_at IS NULL)
);
CREATE INDEX IF NOT EXISTS platform_task_creator_v2 ON platform_task(domain_id, creator_id, app_id);
CREATE INDEX IF NOT EXISTS platform_task_due_v2 ON platform_task(next_run_at) WHERE enabled AND pause_code IS NULL;
CREATE TABLE IF NOT EXISTS platform_task_run (
 id uuid PRIMARY KEY, task_id uuid NOT NULL REFERENCES platform_task(id) ON DELETE CASCADE,
 definition_snapshot jsonb NOT NULL, trigger text NOT NULL, status text NOT NULL DEFAULT 'running',
 scheduled_at timestamptz, dispatched_at timestamptz, deadline timestamptz,
 started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 handle jsonb, result_link jsonb, result_summary text, execution_details jsonb,
 result text, error_code text, error_message text, spend_time bigint,
 CHECK (status IN ('running','completed','failed','skipped'))
);
CREATE UNIQUE INDEX IF NOT EXISTS platform_task_one_running_v2 ON platform_task_run(task_id) WHERE status='running';
CREATE INDEX IF NOT EXISTS platform_task_history_v2 ON platform_task_run(task_id,started_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS platform_task_credential (
 domain_id text NOT NULL, creator_id text NOT NULL, sealed_key text, valid boolean NOT NULL,
 PRIMARY KEY(domain_id,creator_id)
);
