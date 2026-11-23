# Model usage

- Use `usageForm` to select the domain default chat model and domain embedding model by public model name. Saving changes asks for confirmation and triggers a vector rebuild when the embedding model changes.
- Check `vectorStatus` for the current vector rebuild state and use `rebuildVectors` / `pauseVectorRebuild` to start, resume, or pause indexing.
- Review `agentUsages` to see which models ontology service agents currently select; open `/settings/model-config/providers` to manage connections and models or `/settings/model-config/agents` to edit system agent selections.
