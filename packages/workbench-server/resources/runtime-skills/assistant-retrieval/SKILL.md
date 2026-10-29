---
name: assistant-retrieval
description: Delegate a complete business data question to the Ontomato retriever and download its accepted dataset files, or resume the same retrieval after a user reply.
---

Write a JSON request in work/ and run:

`node skills/assistant-retrieval/scripts/ask.mjs @work/question.json`

For a new question: `{"question":"the entire question including relevant user quotes"}`.
For continuation: `{"retrievalId":"ID printed previously","message":"user reply"}`.
The command waits for the ordinary run to stop, prints its answer and PI state,
and writes accepted datasets under outputs/retrievals/. A text question is a normal
reply; ask the user and retain the retrieval ID for continuation. Do not fabricate
an answer or turn a lack of files into a failure. Use files without rewriting rows.

Environment: ONTOMATO_WORKBENCH_URL, ONTOMATO_TK and optional ONTOMATO_LANGUAGE.
In product, its existing callback credential is ONTOMATO_RETRIEVAL_CALLBACK_TOKEN;
ONTOMATO_TK remains the ordinary user credential for standard skills.
In product, ONTOMATO_RUN_ID and ONTOMATO_ASSISTANT_SESSION_ID bind the command to
its parent run. Outside the product omit the assistant session variable: the same
script calls the public retrieval API with your user token, with no parent run or
product checkout required. It still resumes the same retriever after a reply.
The runtime service credential is never needed. Receipt files in work/ preserve
request IDs across transport retries; use a new request file for a new operation.
