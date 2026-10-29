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
    enabled: boolean;
    tags: string[];
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

For each **new run**, the host reads the current definition and domain enablement.
Only selected, enabled skills enter `definition.skills`; disabling preserves the
saved selection, re-enabling restores eligibility, deletion removes domain
references. Missing or invalid selected packages fail preparation rather than
using an old publication. Unselected packages never enter the installed tree or
PI catalogue. Existing duplicate-name admission rules still apply.

## Package and publication

SkillInfo also returns the complete `skill` reference for selection after import.
The existing management URLs, permission (`skill-management`), ZIP import/export
and read-only public-package rule remain. An authorized save/import approves the
package for use by selected agents. A new domain package uses standard
`SKILL.md` frontmatter plus ordinary scripts/references. Required identity and
description validation is shared with runtime publication through contracts.
Private top-level `type/category/entries` and an exported `execute(input)` are no
longer package requirements. No private execution manifest is generated.

The existing form's descriptive fields use optional string-valued
`metadata["ontomato.<field>"]` entries: type, category, title, tags (JSON array),
version and outputType. These are workbench presentation/editor hints, not runtime
dispatch or version selectors. A plain standard package requires none of them;
the view defaults to category analysis, derives type from script presence, and
uses name/empty tags/empty version when hints are absent. Import/export preserves
package bytes; form edits preserve unrelated standard fields and package files.
Optional `ontomato.defaultEnabled` retains initial enablement for bundled public
packages; domain overrides remain authoritative and do not select an agent's
skills. New form templates document an ordinary CLI and file outputs.

At new-run preparation the workbench publishes the selected domain directory's
exact files with `POST /v1/skills`, using its existing service credential and the
verified `X-Domain-Id`. The stored source directory owns edits; the runtime owns
immutable published versions. Saving edits changes that source; successful run
preparation publishes it before admission. Publication failure prevents the run,
with no stale-package fallback. This reuses UTF-8 package transport; import and
publication reject non-UTF-8 files, without replacement decoding or dropping files.

Admission resolves each name to its current digest and stores `resolvedSkills`.
Active runs keep those files; the next run, including the next message in an old
session, resolves again. Idempotent retries return their original run without
republishing or resolving a new version. Source changes and publication/admission
are serialized per domain so a delayed preparation cannot republish older bytes
after a newer edit. No stored-data conversion or session-level version pin is added.

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
