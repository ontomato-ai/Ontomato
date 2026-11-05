CREATE TABLE IF NOT EXISTS platform_task (
 id uuid PRIMARY KEY, domain_id text NOT NULL, owner_id text,
 app_id text NOT NULL, name text NOT NULL, description text,
 target jsonb NOT NULL, frequency jsonb NOT NULL, time_zone text NOT NULL,
 function_id text GENERATED ALWAYS AS (target->>'functionId') STORED REFERENCES function(id),
 enabled boolean NOT NULL DEFAULT true, paused_reason text, next_run_at timestamptz,
 notify_email text, locale text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((target->>'kind'='agent' AND target->>'agentId' IS NOT NULL AND owner_id IS NOT NULL AND function_id IS NULL)
     OR (target->>'kind'='function' AND function_id IS NOT NULL AND owner_id IS NULL))
);
CREATE INDEX IF NOT EXISTS platform_task_owner ON platform_task(domain_id, owner_id);
CREATE INDEX IF NOT EXISTS platform_task_due ON platform_task(next_run_at) WHERE enabled AND paused_reason IS NULL;
CREATE INDEX IF NOT EXISTS platform_task_function ON platform_task(function_id) WHERE function_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS platform_task_run (
 id uuid PRIMARY KEY, task_id uuid NOT NULL REFERENCES platform_task(id) ON DELETE CASCADE,
 target jsonb NOT NULL, session_id uuid, trigger text NOT NULL, status text NOT NULL DEFAULT 'running',
 dispatched_at timestamptz, deadline timestamptz, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 result text, error_code text, error_message text, spend_time bigint
);
CREATE UNIQUE INDEX IF NOT EXISTS platform_task_one_running ON platform_task_run(task_id) WHERE status='running';
CREATE INDEX IF NOT EXISTS platform_task_history ON platform_task_run(task_id,started_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS platform_task_credential (
 domain_id text NOT NULL, owner_id text NOT NULL, sealed_key text, valid boolean NOT NULL, PRIMARY KEY(domain_id,owner_id)
);
