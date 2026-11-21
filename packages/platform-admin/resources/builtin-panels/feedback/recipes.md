# User feedback records

This page lists the feedback the domain's users gave on query answers and analysis-task results. It is read-only:
nothing on this page modifies feedback records, so there are no form drafts or write operations.

- The list reads the owner's `query` read of `platform:FeedbackRecord` and pages on the server.
- The current filters live in the panel state fields `search` (keyword), `sourceType` (`all`, `qa`, `analysis_task`)
  and `rating` (`all`, `like`, `dislike`). All three are deep-linkable: read them to learn what the reader is looking
  at, set them to change the filters, or open an address carrying them.
- `selected` is the feedback record the reader chose. Read the owner `record` for its user, source, rating, turn key,
  user input, assistant output and feedback text to interpret or summarise it.
- To summarise or group feedback, first read the current filter state, then read the selected record or ask the
  reader which records matter.
- The `export` operation (member `exportCsv`, owner `feedback.export`) downloads a CSV of every record matching the
  filters, not just the visible page. Its input is `{search?, sourceType?, rating?, timeZone}`; pass the current
  filter values and the reader's IANA time zone.
