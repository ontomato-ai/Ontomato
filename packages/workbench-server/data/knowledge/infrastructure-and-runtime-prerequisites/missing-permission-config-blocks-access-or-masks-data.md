# Missing Permission Configuration Causes Pages Inaccessible or Data Masked

- **Scope**: pages, entries, APIs, evidence operations, or business data are unavailable or visibly restricted because the current identity lacks the corresponding authorization.
- **Mechanism source**: workbench management operations in `packages/workbench-server/src/api/routes/ops-diagnosis.ts` and ontology query authorization in `packages/data-engine-core/src/main/java/io/ontomato/dataengine/service/QueryPermissions.java`.

## Symptoms

- A page, menu entry, button, or evidence operation is unavailable or returns an authorization error.
- Metadata is incomplete for one identity, query admission is forbidden, rows are fewer than expected, or cells contain `****`.

## Possible Causes

- **Management authorization missing**: the identity cannot use the operations evidence, log, knowledge, configuration, or read-only DSL entry required for the action.
- **Business data permission missing**: the identity has no visible class/field, a relationship endpoint is outside scope, row permission filters the result, or column permission masks output values.
- Login state, service failure, and proxy failure can imitate authorization failure and must be excluded by the exact status, machine code, and dependency evidence.

## Verification and Localization

1. Record the identity, entry, status code, machine code, time, and whether the same identity can use a neighboring read-only entry.
2. For data symptoms, compare visible metadata and the exact query result under known identities. Do not infer authorization from the answer text.
3. For `****`, first follow [Mechanism triage for masked placeholders appearing in results](desensitized-placeholder-mechanism-triage.md) and confirm the placeholder is really in the accepted data.
4. Permission changes belong to the owning permission system and an authorized administrator. After a change, retest as the same identity and verify that only the intended scope opened.

## When to Exclude

- The dependency or service itself is unavailable — investigate services first.
- The query is rejected for unknown metadata or invalid DSL shape — investigate metadata or the query artifact rather than permission.
