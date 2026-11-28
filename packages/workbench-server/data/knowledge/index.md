# Operations Knowledge

This directory stores the product operations model and failure modes that the operations Agent reads on demand. It helps establish product expectations and locate evidence. It does not store the current value of any environment, and it does not replace the current round of evidence or the user's business-correctness baseline.

## Choose a Topic by Goal

| Current goal | Minimum read scope |
| --- | --- |
| A page, service, or query is unavailable; configuration, permission, metadata, or startup prerequisites are suspected | `infrastructure-and-runtime-prerequisites/index.md`, then only the matching topic or failure mode |
| A business data question yields no dataset, unexpected data, or a reply unsupported by the dataset | `standard-query-turn/index.md` |

It is not required to start from this index or to read a topic in full. When the goal is already known from the diagnosis target or page context, read the corresponding file directly.

## Usage Boundaries

- The product model describes stable components, links, invariants, evidence maps, and influence relationships.
- Failure modes only provide candidate causes and verification entry points. Similar symptoms do not equal a match; conclusions must return to the current tool results, runtime artifacts, logs, or user evidence.
- Service status, effective configuration, permissions, metadata, and business data are dynamic facts. Read them through the authorized evidence entry points or ask the user to supplement facts the entry points cannot provide.
- The user's expected answer, statistical definitions, and the meaning of business terms do not belong in this knowledge base; when missing, confirm with the user first.
