# App Builder Built-in Panel (`builtin-product-app-builder`)

Three-column application builder workbench ("one project = one application") mounted at `/app-builder` inside `builtin-product-platform-frame` with `pageComposer: "none"`:

- **Left rail**: `platform:Application.builderProjects` (`ObjectList`, layout `"list"`, expandable `#row-detail` mounting `platform:Application.builderSessions` with `rowType: platform:AgentSession` and `load-more` pagination). Unpublished drafts carry an unpublished status tag and route deletion to `applications.deleteDraft`; published applications route deletion to `applications.delete`.
- **Center column**: Official `AgentChat` bound to the built-in `app-builder` preset agent, passing opaque `sessionContext: { appId }`, rendering composer context chips in `#composer-context`, and rendering auto-commit pills (`outcome.commit`) in `#message-actions`.
- **Right workspace pane**: Switchable `side | full | closed` container hosting:
  - **Files**: `ObjectTree` (`sourceFiles`) + `ObjectTextReader` (`sourceFile`).
  - **Changes**: Latest commit / uncommitted changes / specific commit diff via `ObjectTextReader` (`sourceDiff`, `format: "diff"`).
  - **History**: `ObjectList` (`sourceCommits`) with view diff, publish commit, and `applications.restoreSourceCommit`.
- **Publish drawer**: Application identity card, live-definition drift banner with 3-way merge sync (`applications.syncBuilderSource`), merge-conflict file list, `ObjectForm` (`builderPublishForm` + `applications.publishBuilderSource`), and release history with rollback (`applications.rollbackBuilderRelease`).
