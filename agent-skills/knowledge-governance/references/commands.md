# Commands

Every command accepts one JSON object (inline JSON or @file) and prints JSON.

| Command | Arguments |
| --- | --- |
| read-knowledge | query?, id?, index?, offset?, maxChars? (1000–20000); start with {} |
| read-ontology | Same pagination as read-knowledge |
| search-history | query?, agentId?, from?, to?, offset?, limit? (1–100); start with {} |
| read-history | hostId, runId, offset?, maxChars? (1000–20000) |
| read-evidence | hostId, runId, artifactId?, offset?, maxChars?; reads runtime messages/artifacts |
| collect-turn-artifacts | Same arguments as read-evidence; reads existing runtime messages/artifacts, never collects logs |
| read-work-record | Same pagination as read-knowledge |
| update-work-record | Optional summary, notes, reviewedKnowledgeIds, issues |

Source registration accompanies the relevant reads. Never substitute a filename
or a display label for the source ID returned by the host. An issue retains id,
title, category (ontology/knowledge/data), status (proposed/pending/confirmed),
problem, before, after, basis and sourceIds. Unknown request fields are rejected;
read the endpoint's error and correct arguments rather than ignoring a failed read.

History search returns records and nextOffset. Time bounds are ISO timestamps, from inclusive and to exclusive. Each record supplies hostId and runId for subsequent reads. Only user questions, final answers and artifacts are available; feedback, decisions and quality annotations are not returned. A null agentId means that the old run did not record its agent identity.
