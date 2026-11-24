# Data adapters

- Use `adapterForm` to choose the domain's active data adapter mode (a single installed adapter or multi-source routing) and edit its connection fields. Secret fields are never echoed back from the server; leave a saved secret blank to keep the stored value, or type a new value to replace it.
- In multi-source mode, define each data source (with its ID, adapter type, and adapter-specific connection fields), route ontology classes to configured data source IDs, and review derived relationship sources and optional physical edge names for native graph sources.
- Use `testConnection` to test the current unsaved single-source draft, or choose a `testSourceId` in multi-source mode to test one draft data source without saving or switching the domain adapter. Editing the draft automatically clears any previous test report.
