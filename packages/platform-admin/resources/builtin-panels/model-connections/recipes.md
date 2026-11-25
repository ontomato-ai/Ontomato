# Providers & models

- Select a model provider on the left (`selected`) to inspect or edit its provider type, API base URL, and extra headers via `connectionForm`. The API key field starts blank. Ask the user to enter a new key if they want to replace it. Leaving it blank keeps the saved key.
- Use **Add provider** (`creatingConnection: true`) to create a new model provider. The user must enter an API key. `azure` and `custom_openai` also require an API base URL.
- Use **Add model** (`modelDialog: "create"`) or **Fetch model list** (`discoverDialog: true`) to register chat or embedding models under the selected provider. Chat models default to a 262,144-token context window when omitted; embedding models require positive vector dimensions and are unavailable for `anthropic` providers.
- Use **Test** on a model row to run a minimal request through the LiteLLM gateway using the current unsaved provider form.
