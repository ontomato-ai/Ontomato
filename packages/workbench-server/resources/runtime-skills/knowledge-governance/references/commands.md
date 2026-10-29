# Commands

Every command accepts one JSON object (inline JSON or @file) and prints JSON.

| Command | Arguments |
| --- | --- |
| read-knowledge | query?, id?, index?, offset?, maxChars? (1000–20000); start with {} |
| read-ontology | Same pagination as read-knowledge |
| search-history | query?, offset?, limit? (1–20); start with {} |
| read-history | threadId, offset?, maxChars? (1000–20000) |
| read-evidence | turnKey, offset?, maxChars?; reads runtime evidence without collecting files |
| read-work-record | Same pagination as read-knowledge |
| update-work-record | Optional summary, notes, reviewedKnowledgeIds, issues |

Source registration accompanies the relevant reads. Never substitute a filename
or a display label for the source ID returned by the host. An issue retains id,
title, category (ontology/knowledge/data), status (proposed/pending/confirmed),
problem, before, after, basis and sourceIds. Unknown request fields are rejected;
read the endpoint's error and correct arguments rather than ignoring a failed read.
