# Manage agent definitions

Use the selected agent's reference to read its owner record. For an edit draft, read the owner's form first, use
its `save.draftOperation`, and put the changed field values in the draft. Set `target` to
`{"objectType": "platform:AgentDefinition", "id": "<selected agent ID>"}`.
For a new agent, use the owner's create form and set `target` to `{"objectType": "platform:AgentDefinition"}`.
The reader opens the draft and saves through the form.
