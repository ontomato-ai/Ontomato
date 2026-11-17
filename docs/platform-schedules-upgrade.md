# Upgrade to application-declared schedules

This procedure applies to deployments with T4 `platform_task` tables or the earlier workbench `scheduled_tasks` / DataRAG `write_task` sources. Fresh installations create empty application-form tables. Older, pre-runtime `analysis_schedule_rules` deployments need their baseline upgrade first.

The Java, workbench and browser versions must be upgraded together. The new application rejects the old platform-table shape; it does not convert data while scheduling jobs.

## Changes users will see

- Tasks are private to their creator in their domain. Migrated agent tasks keep their creator. Function tasks without a creator are assigned to an active built-in administrator of their domain. When there are several, the earliest membership wins, with user ID as the tie breaker. The check output lists candidates and the selected creator. No administrator means conversion stops for the site to resolve.
- Actions and write functions require `/action/execute`. The retired `/writeTask/*` grants and their directory entries are removed. A role with only write-task grants no longer has permission to schedule functions; the upgrade does not broaden its grants. Imported function tasks belong to the selected domain administrator.
- Execution uses the creator's current membership and permissions, as if that person manually executed the same action. Queries respect that person's data permissions. Writes retain the existing domain and class scope; this release does not add row or field permission checks to writes.
- Tasks without a title use the first nonempty instruction line, or the function name for a function task. IDs, history, cadence, time zone, enabled state and existing future slots are preserved.
- Object, dataset and vector parameters cannot be scheduled. Actions and functions using the retired Python protocol are also unavailable until converted or regenerated for `ontomato-python:2`; existing tasks pause with a target-unavailable reason. All supported parameter fields are optional: blank scalar strings and numbers count as omitted, exactly as for manual Action execution; blank arrays mean an empty array. Other arrays use one item per line. Dates accept `YYYY-MM-DD`, `YYYY-MM-DD HH:mm` in the task's time zone, or RFC3339; an empty scalar time means the actual execution start.
- Busy automated tests are skipped without queuing another batch. A lost start response when the runner actually skipped because it was busy can later be recorded as `interrupted`, because there is no batch file. It is never automatically replayed. Existing result retention still applies.
- Notifications retain the existing SMTP configuration and email format. No public URL configuration is added.

## Converting existing T4 platform tables

1. Arrange a maintenance window. Suspend automatic updates, stop new admissions and let in-flight runs, especially writes, finish. Stop the old workbench, data engine and runtime processes while keeping PostgreSQL available. Back up the DataRAG and workbench databases, runtime data and deployment configuration. Record task/run counts by application and domain. Keep the existing runtime secrets; they seal existing background credentials.
2. Select the new DataRAG image without starting the application. The offline tool uses the deployment's `DATA_ENGINE_JDBC_URL` and `SCHEDULE_TARGET_USER/PASSWORD`, falling back to `POSTGRES_USER/PASSWORD`. Do not print credentials. Use the deployment's Compose files and environment. Replace `enterprise` with `oss` for the public edition.

   ```sh
   docker compose run --rm --no-deps --entrypoint java datarag \
     -cp '/app/lib/*:/opt/datarag/lib/*' io.ontomato.dataengine.schedules.ScheduleMigration \
     forms-check enterprise
   ```

   Review the task and history counts, each domain's administrator candidates and selected creator, and generated titles. The check writes no schedule data. No valid built-in administrator, an invalid rule or unended run blocks conversion. Resolve the reported rows before retrying; do not discard history or invent a creator.
3. With both application processes still stopped, convert in one target-database transaction:

   ```sh
   docker compose run --rm --no-deps --entrypoint java datarag \
     -cp '/app/lib/*:/opt/datarag/lib/*' io.ontomato.dataengine.schedules.ScheduleMigration \
     forms-upgrade enterprise
   ```

   The tool reruns its checks and validates the resulting task/history shape. Repeating it on the converted schema is safe. Conversion replaces the old target columns rather than retaining a second runtime format. Existing unreadable background credentials remain invalid; their owners renew them with an interactive login. Pure Java function/action and governance tasks do not require an internal API Key.
4. Run `forms-check` again, compare counts, IDs, representative titles, creators, cadence/time zones, enabled/paused state and `next_run_at` with the backup. Historical function executions explicitly carry unknown legacy execution identity; migration does not claim they originally ran as their new administrator owner.
5. Start the matching new combination. DataRAG reaches the workbench using the existing `WORKBENCH_INTERNAL_URL`. Verify card ownership with two domain members, migrated function and agent history, all four application forms, manual and scheduled execution, result destinations and permission revocation. Only authorize a real business write after reviewing its effect. Verify mail separately when SMTP is configured.

No customer schedule data is converted by a developer's local test. The main controller executes the backup, mapping review, cutover and acceptance on 128.

## Importing the original two sources

For a deployment that has not completed T4, keep both old application processes stopped. Record the old workbench schedule zone, the old JVM zone, `SERVICE_ID`, source database connection and `PG_SCHEMA`. Back up both databases, runtime data and configuration. Preserve `AGENT_RUNTIME_SERVICE_TOKEN` to open the old workbench credentials and `AGENT_RUNTIME_ONTOLOGY_TOKEN` to reseal them.

The default original source database is `data_agent` for enterprise or `ontomato` for OSS. Custom connections use `SCHEDULE_SOURCE_JDBC_URL` and `SCHEDULE_SOURCE_USER/PASSWORD`; `PG_SCHEMA` selects the source schema. Destination settings are the same as above. The new importer writes the application-form schema directly.

```sh
docker compose run --rm --no-deps --entrypoint java datarag \
  -cp '/app/lib/*:/opt/datarag/lib/*' io.ontomato.dataengine.schedules.ScheduleMigration \
  import enterprise Asia/Shanghai Asia/Shanghai
```

The last two arguments are the old workbench and JVM zones, respectively. Agent identities map unchanged; OSS `system/1` maps to the Java creator `admin/1`, with the workbench retaining its `system/1` session owner. Functions are assigned using the same built-in administrator ordering. Original function histories retain trigger `unknown` and unknown legacy execution identity. Unfinished runs, foreign `SERVICE_ID`, collisions or orphan results stop the import; preserve sources and fix the reported issue before retrying.

After comparing source task and history counts, sample contents, creators and credential states, retire the old tables separately:

```sh
docker compose run --rm --no-deps --entrypoint java datarag \
  -cp '/app/lib/*:/opt/datarag/lib/*' io.ontomato.dataengine.schedules.ScheduleMigration \
  retire enterprise Asia/Shanghai Asia/Shanghai
```

Retirement checks the committed import's source database/schema and target shape. It can be repeated after a partial cross-database retirement. Do not start the old services again after retiring their tables.

## Failure and rollback

A failed conversion transaction leaves the old platform data intact. Keep the old combination stopped, preserve output and backups, correct the specific prerequisite and rerun the check. An unreadable credential is a recoverable task pause, not a reason to replace it with another person's Key.

For rollback, stop the new combination and restore matching database/runtime/configuration backups before starting the old images together. Reconcile any real writes that occurred after cutover before restoring data. A schema rollback alone cannot reverse a business write.

## Migrating the ontology application's tasks to Triggers

A scheduled task of the `ontology` application is a capability that fires on a time table, which is what a Trigger is.
The other three applications do not migrate: `agents` (run an agent), `governance` (patrol business knowledge) and
`operations` (run diagnostics) produce no business write and no execution-plane Run, and a Trigger's effect enum —
action, workflow, skill, notification — has no member that describes "run an agent". Those tasks stay in the platform's
task list.

### What the migration maps

| Source (`platform_task.content.execution`) | Becomes | Why |
| --- | --- | --- |
| `action:<id>` | a Trigger whose effect is that action, verbatim | the same object, now with a status, a revision and a review |
| `function:<id>` | a Trigger whose effect is **the single published Action that wraps that function** | the function path checks only "may this subject execute anything" and skips the per-action grant and the action's preconditions; scheduling the Action is how the same write keeps its governance |
| `function:<id>` with zero or two or more wrapping actions | **not migrated**; reported as `skippedNoAction` | two actions over one function are two capabilities with different preconditions and approvers — picking one would choose the governance for the operator |
| anything else | not migrated; reported as `skippedOther` | the effect cannot be expressed |

A Trigger never carries a `function` effect. Adding one would make "schedule a write that bypasses the Action" a
supported path, which is the opposite of what this migration is for.

### What happens to the source row

The migration is idempotent: the trigger id is the task id, so a second run finds the trigger and only finishes the
bookkeeping. For each migrated task the row is disarmed (`enabled=false`, `next_run_at=NULL`) and marked
(`migrated_to_trigger=<trigger id>`). Marked rows are excluded from the task list and from the scheduler's due query,
so the same moment cannot fire twice — once from the task table and once from the Trigger.

The row is kept, not deleted: it is the only link between the old task and its firing history
(`platform_task_run` cascades on delete).

### Retiring the old path

`OntologyScheduleApplication.acceptsNewTasks()` returns false, so creating a new ontology task answers
`该应用已改为使用「触发」创建，请在触发页面新建`. The application is also **no longer offered in the picker at all**: the
applications list skips every application that refuses new tasks, because a picker exists to start something new.
Existing rows stay addressable — their detail, their run history and the rollback path still resolve through
`applications.require`, they are simply no longer a place to start a task from.

### Procedure

```bash
# 1. look first: how many ontology tasks are there, and of which shape
curl -s -X POST $BASE/api/data-query/platform/scheduled-tasks?appId=ontology -H "tk: $TK"

# 2. migrate (idempotent; safe to run twice)
curl -s -X POST $BASE/api/data-query/trigger/migrate-ontology-tasks -H "tk: $TK"
# -> {"migrated":1,"fromFunction":0,"skippedNoAction":0,"skippedOther":0,"skippedIds":[]}

# 3. for every id in skippedIds: create or identify the Action that wraps the task's write function,
#    publish it, grant it, then run step 2 again.
```

### Rollback

Per task: delete the Trigger (`/trigger/delete`), clear the marker
(`UPDATE platform_task SET migrated_to_trigger=NULL, enabled=true, next_run_at=<next slot> WHERE id=?::uuid`) and the
platform scheduler picks it up again. Roll back only while the task was disabled by this migration — re-arming a task
that was already off would start something nobody asked for.
