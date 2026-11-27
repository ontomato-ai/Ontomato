---
name: knowledge-submit
description: Submit a business scope the user confirmed as pending business knowledge for administrator review.
compatibility: Requires Node.js 18 or newer inside an Ontomato hosted execution.
---

# Knowledge submit

Run commands from the workspace root as `node <this-skill>/scripts/submit.mjs <command>`, where `<this-skill>` is the directory this SKILL.md is in. `@file` arguments are relative to the workspace root.

The hosted execution supplies `ONTOMATO_KNOWLEDGE_SUBMIT_URL` and `ONTOMATO_EXECUTION_CALLBACK`.

Submit only what the user agreed to save. One entry holds one rule:

- `title` names the term or scope it settles, for example "College (unit level)".
- `text` states the rule in business terms the way a reader of the business knowledge page would apply
  it, without field names, codes or this conversation's figures.
- `quote` is the user's own words, copied as they wrote them.

When the ontology-query skill is available, search with its `knowledge` command first. If an approved
entry already says the same, do not submit; if one contradicts it, tell the user instead of submitting.
A submission with the same text as an existing entry returns that entry instead of a new one.

## Commands

| Command | Input and output |
| --- | --- |
| `submit <json\|@file>` | Submits one pending business knowledge entry. Input is a JSON object with nonempty string fields `title`, `text` and `quote`. `quote` is the user's original wording. Prints `{id,status,created}`: `status` is `0` for a new pending entry; `created` is `false` when Java returned an existing entry with the same normalized content instead of creating another entry. |
