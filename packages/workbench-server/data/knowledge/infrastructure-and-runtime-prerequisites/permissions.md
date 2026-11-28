# Permissions

- **Scope**: management authorization for diagnosis evidence entry points, and class, relationship, row, and column data permissions in ontology query execution. This file does not store any user, role, position, or domain's current permissions.
- **Implementation source**: `packages/workbench-server/src/api/routes/ops-diagnosis.ts`, `packages/data-engine-core/src/main/java/io/ontomato/dataengine/service/QueryPermissions.java`, `service/OntologyQueryService.java`, and `util/DslPermissionUtil.java`.

## Role and Dependencies

- Operations evidence endpoints have their own management operations. Access to logs, runtime evidence, metadata, configuration, knowledge, or read-only DSL execution is therefore separate from whether the same identity can read a business class.
- Ontology metadata is filtered by `UserDataPermission` and by the run's class scope. Classes with no readable attributes, unauthorized fields, and relationships whose endpoints are not both visible do not appear in the visible rule.
- Query admission checks classes, fields, and relationships before execution. A retrieval caller cannot widen the class scope it was given. Row permissions are injected into object conditions; objects that read a temporary table saved earlier in the same DSL are skipped because row rules belong to registered business classes.
- Column masking happens after execution from the output source analysis. A denied output column is replaced with `****`; nested vector or bucket values can be partially masked when only some children are unauthorized.

## On-Site Evidence

- There is no diagnosis tool that lists a user's effective external authorization. Use the exact page/API status and machine code, the identity that executed the request, the visible metadata, result differences under known identities, and permission facts supplied by an authorized administrator.
- Execute the same narrow read-only query under the same identity when testing data permission. The caller's current permissions are part of the evidence; a result read by another identity does not prove what this caller can see.
- Masking and row filtering are quiet data behaviors. Absence of a dedicated log line is not evidence that permission was not applied.

## Deviation Propagation and Verification

- Entry authorization failures appear before the business query. Data permission deviations appear as missing visible metadata, forbidden query admission, fewer rows, or masked columns, and then propagate into answers, charts, and reports.
- Permission changes must be made by an authorized user in the owning permission system. After a change, retest with the same identity and confirm that only the expected scope became visible.
