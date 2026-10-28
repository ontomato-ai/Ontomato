import { qualifiedTable as t } from "../../postgres";
import type { QueryableClient } from "../helpers";
export async function ensureAssistantSchema(c: QueryableClient) {
  await c.query(`CREATE TABLE IF NOT EXISTS ${t("assistant_external_threads")} (
    domain_id text NOT NULL, owner_id text NOT NULL, alias text NOT NULL, session_id uuid NOT NULL,
    PRIMARY KEY(domain_id,owner_id,alias));
  CREATE TABLE IF NOT EXISTS ${t("assistant_agents")} (
    id uuid PRIMARY KEY, domain_id text NOT NULL, kind text NOT NULL, name text NOT NULL,
    description text NOT NULL DEFAULT '', icon text, enabled boolean NOT NULL DEFAULT true,
    system_prompt text NOT NULL, model_role text NOT NULL DEFAULT 'general',
    skills jsonb NOT NULL DEFAULT '[]', class_names jsonb NOT NULL DEFAULT '[]',
    graph_scope jsonb NOT NULL DEFAULT '{"mode":"panorama"}', enabled_mcp_service_ids jsonb NOT NULL DEFAULT '[]',
    sort_order integer NOT NULL DEFAULT 0, UNIQUE(domain_id,kind));
  ALTER TABLE ${t("assistant_agents")} ADD COLUMN IF NOT EXISTS enabled_mcp_service_ids jsonb NOT NULL DEFAULT '[]';
  CREATE TABLE IF NOT EXISTS ${t("assistant_sessions")} (
    id uuid PRIMARY KEY, domain_id text NOT NULL, owner_id text NOT NULL,
    agent_id uuid NOT NULL,
    title text NOT NULL DEFAULT '', latest_run_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now());
  CREATE INDEX IF NOT EXISTS assistant_sessions_owner ON ${t("assistant_sessions")}(domain_id,owner_id,updated_at DESC,id DESC);
  CREATE TABLE IF NOT EXISTS ${t("assistant_turns")} (
    id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES ${t("assistant_sessions")}(id) ON DELETE CASCADE,
    request_seq integer NOT NULL, input_hash text NOT NULL, class_names jsonb NOT NULL DEFAULT '[]', open boolean NOT NULL DEFAULT true, admitted boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(session_id,request_seq));
  CREATE TABLE IF NOT EXISTS ${t("assistant_retrievals")} (
    operation_id uuid PRIMARY KEY, retrieval_id uuid NOT NULL, request jsonb NOT NULL, input_hash text NOT NULL, retrieval_run_id uuid, session_id uuid NOT NULL REFERENCES ${t("assistant_sessions")}(id) ON DELETE CASCADE,
    parent_run_id uuid NOT NULL REFERENCES ${t("assistant_turns")}(id) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS ${t("assistant_feedback")} (
    id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES ${t("assistant_sessions")}(id) ON DELETE CASCADE,
    run_id uuid NOT NULL, target_kind text NOT NULL, target_id uuid NOT NULL,
    rating text NOT NULL, text text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(session_id,run_id,target_kind,target_id));
  CREATE TABLE IF NOT EXISTS ${t("assistant_auxiliary_sessions")} (
    id uuid PRIMARY KEY, domain_id text NOT NULL, owner_id text NOT NULL, parent_session_id uuid,
    created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS ${t("user_memories")} (
    domain_id text NOT NULL, user_id text NOT NULL, key text NOT NULL, value jsonb NOT NULL,
    PRIMARY KEY(domain_id,user_id,key));
  CREATE TABLE IF NOT EXISTS ${t("user_preferences")} (
    user_id text NOT NULL, key text NOT NULL, value jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(user_id,key));`);
}
