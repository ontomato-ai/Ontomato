# Domain skills in the standard runtime

Implemented 2026-10-29 after controller review on 2026-10-28. This extends
[assistant actions](assistant-chat.md) and the [host projection](agent-host.md).
[Runtime publication/admission](agent-runtime.md) still owns package transport,
digests, installed files and execution. [Design and review points](../../docs/domain-skills-runtime-design.md)
own replacement scope.

## Selection and identity

Add `GET /api/assistant/agent-skills`, using the definition-management permission:

```ts
type AssistantSkillCatalog = {
  skills: {
    skill: RuntimeSkillRef;
    title: string;
    description: string;
  }[];
};
```

The workbench constructs this catalogue from its published provider packages and
the caller's domain directory. Provider identity comes from the publication
owner; domain identity comes from verified authentication. The selector uses the
complete namespace/name identity and edits the existing single `skills` list.
Provider references must be selectable/removable, not silently preserved outside
that list. Definition writes retain the domain-completion rule in assistant-chat.
Catalogue read failure prevents saving a replacement selection.

For each **new run**, the host reads the current definition. Exactly the selected
skills enter `definition.skills`; there is no domain-wide enablement (removed
2026-11-12), and deletion removes domain references. Missing or invalid selected packages fail preparation rather than
using an old publication. Unselected packages never enter the installed tree or
PI catalogue. Existing duplicate-name admission rules still apply.

## Package and publication

SkillInfo also returns the complete `skill` reference for selection after import.
The management URLs, permission (`skill-management`), ZIP import/export
and read-only public-package rule remain. An authorized import approves the
package for use by selected agents. A domain package uses standard
`SKILL.md` frontmatter plus ordinary scripts/references. Required identity and
description validation is shared with runtime publication through contracts.
Private top-level `type/category/entries` and an exported `execute(input)` are no
longer package requirements. No private execution manifest is generated.

A package is its standard frontmatter (`name`, `description` and the other
standard fields) with its scripts and references; since 2026-11-12 the platform
reads nothing from `metadata`, including the `ontomato.*` hints older packages
still carry, and neither strips nor rejects them. A skill is listed under the
edition's label for a built-in skill (name and description, by skill name), else
under its own name and description. Import/export preserves package bytes;
importing a package with an existing name replaces the whole package after
confirmation. Packages are not edited in place, and there is no domain-wide enablement: an
agent uses exactly the skills selected in its definition.

At new-run preparation the workbench publishes the selected domain directory's
exact files with `POST /v1/skills`, using its existing service credential and the
verified `X-Domain-Id`. The stored source directory owns the package; the runtime
owns immutable published versions. An import replaces that source; successful run
preparation publishes it before admission. Publication failure prevents the run,
with no stale-package fallback. This reuses UTF-8 package transport; import and
publication reject non-UTF-8 files, without replacement decoding or dropping files.

Admission resolves each name to its current digest and stores `resolvedSkills`.
Active runs keep those files; the next run, including the next message in an old
session, resolves again. Idempotent retries return their original run without
republishing or resolving a new version. Source changes and publication/admission
are serialized per domain so a delayed preparation cannot republish older bytes
after a newer import. No stored-data conversion or session-level version pin is added.

## Credentials and history

Assistant and administrative skill-preview runs receive the current user's token
as `environment.secrets.ONTOMATO_TK`, sent by scripts as `tk`. API-key requests
retain their authentication kind: `ONTOMATO_API_KEY`, sent as `x-api-key`;
anonymous public-edition requests need neither. Workbench-owned scripts support
these ordinary authentication forms. Workbench/ontology base URLs come from the
existing host configuration. Ordinary resource/user/domain checks remain with the
API owner. All selected scripts use the same run environment. The
[ontology retrieval cutover](data-retrieval.md) removes assistant-retrieval and
its ONTOMATO_RETRIEVAL_CALLBACK_TOKEN. The shared analyst uses the current user
credential and a non-secret caller scope ID.

Add `resolvedSkills: RuntimeRegisteredSkill[]` to the common `AgentHostRun`
projection, taken directly from the runtime run in admissions, snapshots and
session views. It exposes namespace/name/digest/description for historical
inspection without reading the current catalogue. Reuse the runtime schema;
do not recompute digests in the browser or workbench. Files and Markdown still
follow [agent-artifact-markdown](agent-artifact-markdown.md).
