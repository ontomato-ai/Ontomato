# Example: an agent that does RAG retrieval and data questions

One regular agent: when a user asks "what does the policy say", it searches document text and cites the source; when asked "how many records did each unit report this year", it queries through the ontology. The example below uses official documents and walks from modeling to verification; each step gives the essentials, and the detailed method lives in the named skill.

## 1. Modeling (ontomato-ontomap-builder)

Two classes; a chunk belongs to its document:

| Class | Attributes | Notes |
| --- | --- | --- |
| `document` | `doc_id` (primary key), `title`, `doc_no`, `issuer`, `issue_date`, `source_url` | One document; `source_url` opens the original and becomes the citation link |
| `chunk` | `chunk_id` (primary key), `doc_id`, `seq`, `title`, `doc_no`, `issue_date`, `source_url`, `content` (`vector`) | One piece of a document; `content` carries the text resource used for retrieval |

Each chunk keeps a copy of its document's title, number, date and source URL, so retrieval reads the `chunk` class alone and still returns the citation without crossing a relationship. The relationship `chunk --belongs to--> document` (`chunk.doc_id = document.doc_id`) is still defined for data questions per document. Each class has exactly one enabled varchar primary key.

## 2. Loading data (ontomato-ontomap-builder)

- Create both tables with `db-sql`, `db-import` `document.csv` and `chunk.csv`, and `set-ontomap` so the definition matches.
- Import chunks with `upload-vectors`, one line each:

```json
{"className":"chunk","attrName":"content","objectId":"D2024-017-03","text":"Notice on strengthening procurement | No. 17 [2024] | 2024-05-08 | III. Tendering procedure | …body…"}
```

`text` must carry the title, number, date and section; with the body alone, those details in a question cannot be found.

## 3. Retrieval MetricView (ontomato-app-builder)

Write a read-only MetricView following "Retrieval Function" in app-builder, named for example "Document search":

- Parameters: `query` (`TYPE_STRING`, one sentence describing what to find) and `top_k` (`TYPE_NUMBER`, default 8).
- The DSL's first step outputs `title`, `doc_no`, `issue_date`, `source_url` and `content` of `chunk` to a temporary table; the second step puts `query` and `topK` on `content`.
- Each result returns `title`, `doc_no`, `issue_date`, `text` (the chunk content) and `url` (from `source_url`).
- Save it as published and try `metric-view execute <id> '{"query":"tendering procedure"}'` to check order and content.

## 4. The agent (this skill)

Find the `id` of "Document search" with `metric-views`, then `agent save @agent.json`:

```json
{
  "name": "Documents and reporting Q&A",
  "description": "Answers policy and matter questions from document text, and queries reporting data.",
  "executionMode": "loop",
  "reportDeliverableEnabled": false,
  "enabledMetricViewIds": ["<id of Document search>"],
  "classNames": [],
  "isEnabled": true,
  "loopPrompt": "You answer questions about official documents and reporting data. Answer quickly and accurately, with sources.\n\n- Rules, requirements, notices and meeting decisions: run \"Document search\" directly with `execute_metric_view`, writing query as one complete sentence and top_k as 8. Search once; only if the results are clearly off, rephrase and search one more time.\n- Metrics, counts, amounts, rankings and period comparisons: use `collect_evidence`, stating the whole question at once with object, metric, definition and time range.\n- When a question needs both (for example \"how far has each unit got with the requirements of notice 17\"), call both tools in the same round.\n- Give the conclusion first, then the support. For each document cite title and number and link it as `[source](url)`; for data, state the definition and period. If the results hold no support, say so instead of inventing one.\n- Do not write a report or draw a chart unless asked."
}
```

- `reportDeliverableEnabled: false` makes a regular agent that answers turn by turn, suited to fast answers.
- Empty `classNames` leaves data questions unrestricted; list the reporting classes to limit them. Retrieval is not affected.
- `execute_metric_view` and `collect_evidence` are fixed tool names of the runtime; the description and parameters of "Document search" go into the prompt automatically.

## 5. Verify

Select the agent in the page and ask one of each:

| Question | Expected |
| --- | --- |
| Knowledge, e.g. "What does the tendering procedure require?" | The run shows one MetricView call; the answer cites title, number and a `[source]` link that opens the original |
| Data, e.g. "How many records has each unit reported this year?" | It queries data without calling retrieval; the numbers match a direct data question |
| Both, e.g. "Under notice 17, how far has each unit got?" | Retrieval and data query run in the same round; both parts of the conclusion are supported |

When retrieval misses, run `metric-view execute` on its own to see the ranking: usually the chunk text lacks context, so go back to step 2, rewrite `text` and re-import (re-importing appends, so delete the old resources or clear and rebuild first). When answers are slow, count the tool rounds in the run and tighten the search and query limits in the prompt.
