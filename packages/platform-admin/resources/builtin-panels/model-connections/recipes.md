# Providers & models

- Select a named connection on the left (`selected`) to inspect or edit its provider prefix, API base URL, and extra headers via `connectionForm`. The API key field starts blank. Ask the user to enter a new key if they want to replace it. Leaving it blank keeps the saved key.
- Use **Add connection** (`creatingConnection: true`) to create a new named connection. The user must enter an API key. `azure` and `custom_openai` also require an API base URL.
- Use **Add model** (`modelDialog: "create"`) or **Fetch model list** (`discoverDialog: true`) to register chat or embedding models under the selected connection. Chat models default to a 262,144-token context window when omitted; embedding models require positive vector dimensions and are unavailable for `anthropic` connections.
- Use **Test** on a model row to run a minimal request through the LiteLLM gateway using the current unsaved connection form.
