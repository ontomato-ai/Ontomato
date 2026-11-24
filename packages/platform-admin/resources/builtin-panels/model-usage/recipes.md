# Model usage

- Use `usageForm` to select the domain default chat model, domain embedding model, and optional per-task overrides for the four system background tasks (`quality`, `describe`, `explain`, `metric`). Leaving a background task on the domain default option follows the domain default chat model. Saving default changes asks for confirmation and triggers a vector rebuild when the embedding model changes.
- Check `vectorStatus` for the current vector rebuild state and use `rebuildVectors` / `pauseVectorRebuild` to start, resume, or pause indexing.
- Open `/settings/model-config/providers` to manage model providers and models.
