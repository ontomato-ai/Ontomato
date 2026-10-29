---
name: generate-ppt
description: Generate a downloadable PowerPoint presentation from the entire current conversation, including query tables, charts and explanations.
metadata:
  ontomato.type: executable
  ontomato.category: analysis
  ontomato.title: Generate PPT
  ontomato.tags: '["ppt","powerpoint","presentation"]'
  ontomato.version: 1.0.0
  ontomato.outputType: json
  ontomato.defaultEnabled: "false"
  ontomato.useCases: '["Create a PPT from the conversation"]'
---

## Standard CLI

Write the documented input to a JSON file and run:

`node skills/generate-ppt/scripts/index.mjs`

The command writes its result under `outputs/` and prints the file path.
Reference that path in Markdown. The command runs unchanged in an external harness;
use the package's local path when it is installed somewhere other than `skills/`.

# Generate PPT

Export the current conversation through the authenticated workbench export API.
The host collects its existing evidence and produces the presentation.
Do not invent a successful export when the command fails.

## Environment and external use

Set `ONTOMATO_WORKBENCH_URL` to the workbench base URL before `/api`.
Use `ONTOMATO_TK` for your user token or `ONTOMATO_API_KEY` for your API key;
the public anonymous edition requires neither. `ONTOMATO_LANGUAGE` is optional.
In product, `ONTOMATO_ASSISTANT_SESSION_ID` identifies the current conversation.
In an external harness, pass a JSON file containing `{"sessionId":"your conversation ID"}`
as the command's argument. The same API checks access to that conversation.
`ONTOMATO_OUTPUT_DIR` overrides the default `outputs/` directory.
