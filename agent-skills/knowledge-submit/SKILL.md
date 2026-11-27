---
name: knowledge-submit
description: Submit a clarified business caliber as pending business knowledge for administrator review.
compatibility: Requires Node.js 18 or newer inside an Ontomato hosted execution.
---

# Knowledge submit

Run commands from the workspace root as `node <this-skill>/scripts/submit.mjs <command>`, where `<this-skill>` is the directory this SKILL.md is in. `@file` arguments are relative to the workspace root.

The hosted execution supplies `ONTOMATO_KNOWLEDGE_SUBMIT_URL` and `ONTOMATO_EXECUTION_CALLBACK`.

## Commands

| Command | Input and output |
| --- | --- |
| `submit <json\|@file>` | Submits one pending business knowledge entry. Input is a JSON object with nonempty string fields `title`, `text` and `quote`. `quote` is the user's original wording. Prints `{id,status,created}`: `status` is `0` for a new pending entry; `created` is `false` when Java returned an existing entry with the same normalized content instead of creating another entry. |
