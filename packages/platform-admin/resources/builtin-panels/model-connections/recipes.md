# Connections & models

- Select a named connection on the left (`selected`) to inspect or edit its provider prefix, API base URL, masked API key, and extra headers via `connectionForm`.
- Use **Add connection** (`creatingConnection: true`) to create a new named connection. `azure` and `custom_openai` require an API base URL; leaving the masked API key unchanged on edit keeps the stored secret.
- Use **Add model** (`modelDialog: "create"`) or **Fetch model list** (`discoverDialog: true`) to register chat or embedding models under the selected connection. Chat models default to a 262,144-token context window when omitted; embedding models require positive vector dimensions and are unavailable for `anthropic` connections.
- Use **Test** on a model row to run a minimal request through the LiteLLM gateway using the current unsaved connection form.
