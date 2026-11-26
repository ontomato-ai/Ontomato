CREATE TABLE IF NOT EXISTS trigger_def (
 id text PRIMARY KEY, domain_id text NOT NULL, creator_id text NOT NULL,
 executor_id text NOT NULL, coauthor_ids jsonb NOT NULL DEFAULT '[]', reviewed_by text,
 status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (status IN ('PENDING_REVIEW','PUBLISHED','UNUSED')),
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 target_kind text NOT NULL CHECK (target_kind IN ('action','workflow','application')),
 target_id text, app_id text, title text NOT NULL, description text, content jsonb NOT NULL, form_revision text,
 summary jsonb NOT NULL, revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
 frequency jsonb NOT NULL, time_zone text NOT NULL,
 enabled boolean NOT NULL DEFAULT false, pause_code text, pause_message text, next_run_at timestamptz,
 last_fired_at timestamptz,
 notify_email text, locale text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (char_length(title) BETWEEN 1 AND 255),
 CHECK ((target_kind='application' AND app_id IS NOT NULL AND form_revision IS NOT NULL AND target_id IS NULL)
     OR (target_kind<>'application' AND app_id IS NULL AND form_revision IS NULL AND target_id IS NOT NULL)),
 CHECK (NOT enabled OR status='PUBLISHED'),
 CHECK (enabled OR (pause_code IS NULL AND next_run_at IS NULL)),
 CHECK (pause_code IS NULL OR next_run_at IS NULL)
);
CREATE INDEX IF NOT EXISTS trigger_def_domain ON trigger_def(domain_id, status);
CREATE INDEX IF NOT EXISTS trigger_def_creator ON trigger_def(domain_id, creator_id, app_id);
CREATE INDEX IF NOT EXISTS trigger_def_executor ON trigger_def(domain_id, executor_id);
CREATE INDEX IF NOT EXISTS trigger_def_target ON trigger_def(target_kind, target_id);
CREATE INDEX IF NOT EXISTS trigger_def_due ON trigger_def(next_run_at) WHERE status='PUBLISHED' AND enabled AND pause_code IS NULL;
CREATE TABLE IF NOT EXISTS trigger_run (
 id uuid PRIMARY KEY, task_id text NOT NULL REFERENCES trigger_def(id) ON DELETE CASCADE,
 definition_snapshot jsonb NOT NULL, trigger text NOT NULL, status text NOT NULL DEFAULT 'running',
 scheduled_at timestamptz, dispatched_at timestamptz, deadline timestamptz,
 started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 handle jsonb, result_link jsonb, result_summary text, execution_details jsonb,
 result text, error_code text, error_message text, spend_time bigint,
 CHECK (status IN ('running','completed','failed','skipped'))
);
CREATE UNIQUE INDEX IF NOT EXISTS trigger_run_active ON trigger_run(task_id) WHERE status='running';
CREATE INDEX IF NOT EXISTS trigger_run_history ON trigger_run(task_id,started_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS platform_task_credential (
 domain_id text NOT NULL, creator_id text NOT NULL, sealed_key text, valid boolean NOT NULL,
 PRIMARY KEY(domain_id,creator_id)
);
