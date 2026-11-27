# Upgrade existing schedules to task triggers

Use this cutover once, before starting the first release that uses unified task triggers. It applies to the application-form `platform_task` / `platform_task_run` schema and the former `trigger_def` schema. Fresh deployments need no conversion. Java, workbench, and browser images must be switched together.

## Prepare before replacing any application

- Obtain the matching target images and retain the previous image digests. Save `.env`, Compose files and deployment data, including backups of the DataRAG and workbench databases and the runtime files. Preserve the existing runtime secrets: the converter does not decrypt or reseal members' background credentials.
- Check predecessor storage. A source with T4 `platform_task.target` needs its application-form conversion first. `scheduled_tasks` / `scheduled_task_runs`, `write_task` / `write_task_result`, and `analysis_schedule_rules` are predecessor formats. Complete their separate import/retirement using the approved source-version procedure before this cutover. The tool reports unresolved source rows; it does not treat the unsupported data as a fresh site. In particular the 4.x `analysis_schedule_rules` conversion is a prerequisite of the release migration, not an operation of this tool.
- Suspend automatic updates and prevent new requests in the maintenance window. Let dispatched runs finish, including writes in Java. Stop every old DataRAG and workbench process while leaving PostgreSQL running. In Compose the workbench service is `ontomato` in the public stack and `data-agent` in enterprise. Stop this project's `watchtower` first if enabled. If a run is still reported as running, do not change its terminal state in SQL: restore the old services under the original configuration to let them settle, then stop them and repeat the check.

## Check and apply

From the deployment directory, select the target images without starting the applications. Use the target deployment Compose files and the same database settings as the applications (`DATA_ENGINE_JDBC_URL` for DataRAG; `DATABASE_URL` / `PG_CONNECTION_STRING` and `PG_SCHEMA` for workbench overrides). The command uses the deployed `TZ` for former Trigger definitions with no explicit time zone, so keep the old Java time zone during the conversion. Use the deployment's Compose project name. Do not print database credentials.

```sh
docker compose run --rm --no-deps --entrypoint java datarag \
  -cp '/app/lib/*:/opt/datarag/lib/*' io.ontomato.dataengine.schedules.TriggerUpgrade check oss
```

Use `enterprise` instead of `oss` for enterprise. `check` writes no data and lists expected definition and run counts by domain, and `{domainId,oldTaskId,triggerId}` mappings. Resolve every reported row before running `apply`. In particular an unmarked ontology task calling a function must have exactly one published wrapping Action in the same domain; a migration marker must resolve to an existing same-domain Trigger. An unrelated ID collision is an error, not a reason to overwrite a definition.

Run the same command with `apply` in place of `check`. Save its output with the cutover evidence. It repeats the checks, preserves both sources' identities, attaches marked tasks' runs to the marked Trigger, checks the resulting domain counts, and retires the old scheduler tables and markers. The Workbench reference conversion uses the same domain-scoped mapping; older links to individual execution results retain the original run IDs. It does not rewrite chat or files. Running again on an already converted database does not reimport definitions or runs.

Only then start the new stack, keeping the old images and backups through acceptance. Verify the expected counts, representative prior records (including failure reason and result link), disabled and paused tasks, and that `/schedules` and `/ontology/assets/triggers` open the same definitions in their respective frames. Check that a marked task has one definition and its old history, not a second definition. Do not trigger a real business write merely to verify the upgrade.

## Development cutover and release handoff

The operator coordinates the affected deployment: suspend automatic replacement for the cutover, take the old images and database baseline, perform the preceding sequence once for each Compose project with its matching edition, and resume automatic updates only after verifying the new combination. Do not run these service or data commands on a developer workstation.

For same-major enterprise offline updates, the target package's `update.sh` runs `apply` with the target DataRAG image before `compose up`. Preparation, backup and draining are prerequisites of that command. Online deployments use the explicit Compose procedure: Watchtower cannot perform this conversion. The separate cross-major release migration must run the predecessor conversion and invoke this tool before starting new services; ordinary `update.sh` is not a cross-major entry point.

If conversion fails, do not start the new services. Correct the reported source rows and repeat the check and apply. To roll back instead, keep the new services stopped and restore the paired DataRAG/workbench backups, matching runtime data and old configuration and images. A schema rollback cannot undo writes that already occurred after cutover.
