# Extract and import unstructured business knowledge

Use this workflow when the user asks to turn source text into reusable business knowledge.

1. Establish the source and intended business use. Read the complete relevant source with the governance source commands; preserve the returned source IDs. Use read-input for the current message, or read-history/read-evidence for conversation history and text artifacts. These source commands read content saved by the host; do not invent source IDs.
2. Read the ontology and existing knowledge. Extract discrete, source-supported terminology, facts and attributed statements. Preserve scope, dates, uncertainty and original evidence. Do not invent rules, metrics, object types or relationships.
3. Prepare `items` with stable IDs, concise titles, complete readable text, tags and the registered `sourceIds`. Include source attribution in each text. Avoid duplicate imports; reuse an ID only for the same content.
4. Run `import-knowledge` through the governance skill. In a platform run it writes one business-knowledge form draft per item and prints the draft path and page link. A new form leaves knowledgeID empty so the page uses its create endpoint; an existing item keeps its ID and status. Outside the platform Java checks the current external window, source references and the owner's business-knowledge permission, then imports pending records. Report draft files and confirmed imports accurately.

This operation imports business knowledge, not arbitrary object instances or database tables. If the target is structured business facts, prepare an evidence-backed extraction and use an existing authorized Action or the configured external data-ingestion workflow. A missing capability must be reported; never bypass it with database or HTTP writes.
