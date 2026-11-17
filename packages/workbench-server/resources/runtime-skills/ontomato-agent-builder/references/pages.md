# Page: agent settings

## Addresses

| Address | What it opens |
| --- | --- |
| `/ontology/agents` | The agents of the domain. |
| `/ontology/agents/<id>` | One agent, whose definition ID is `<id>`. |
| `/ontology/agents/new` | A new agent; nothing is selected yet. |

Write a link in an answer as the page's path, for example `[Customer assistant](/ontology/agents/<id>)`. The platform opens it beside the conversation. A draft link is different: it is the exact line `draft-link` prints (see [forms](forms.md)).

## Reading

| Command | Interface | Returns |
| --- | --- | --- |
| `list` | `GET /api/assistant/agent-definitions` | `{"agents":[...]}` — every definition of the domain. |
| `get <id>` | `GET /api/assistant/agent-definitions/<id>` | One definition with the fields in [forms](forms.md). |
| `skills` | `GET /api/assistant/agent-skills` | `{"skills":[{"skill":{"namespace":...,"name":...},"title":"...","description":"..."}]}` — the skills this caller may select. |
| `models` | `GET /api/data-query/model-options` | `{"models":[{"ref":"<provider>/<model>","name":"...","type":"chat",...}],"defaultModelId":...,"embeddingModelId":...}`. |

`skills` and `models` are the catalogs the page offers. A value that is not in them fails validation, so read them before proposing a model or a skill. Only `type: "chat"` models can be selected.

`get` returns the whole definition, including `id`. A save sends the same fields without `id`; read-only values are not fields of the form.

## Page context

A message may end with a line naming the current page and the selected item. On this page the selected item is an agent definition ID: the `:id` segment of `/ontology/agents/<id>`. Use it with `get`; do not find the agent by name, because names need not be unique and may differ by language. On `/ontology/agents` or `/ontology/agents/new` no agent is selected, so ask the user or list the agents and choose by ID.
