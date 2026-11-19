# Scheduled Tasks direct-render performance gate

This runner alternates the native task list and one registered declarative
panel in an authenticated browser. It measures first entry, return through a
shared page, and switching between the same two tasks. It does not submit forms
or trigger tasks. Browser-local responses suppress navigation history updates
and scheduled-task credential renewal, which can resume other tasks owned by
the account. Record the local renewal response when comparing the native path.

Copy the example to a local window configuration. Set the authorized origin,
deadline, source revisions, identity, actual routes and selectors, and the
same two distinct task titles. Supply a link measurement JSON with an asset and
a measured transfer for each group. Each measurement object contains at least
bytes and bytesPerSecond. An instance attribute must reflect the SDK instance
lifecycle to verify the switch criterion.

Start an isolated Chrome instance with a CDP endpoint and authenticate once.
Then run the following commands from the repository root.

```sh
node notes/direct-gate/run.mjs smoke --window-open window.json smoke.json 49361
node notes/direct-gate/report.mjs smoke.json
node notes/direct-gate/run.mjs formal --window-open window.json formal.json 49361
node notes/direct-gate/report.mjs formal.json
```

The Ego Lite adapter takes an existing TaskSpace and the same configuration
and output paths. Run smoke and formal samples in that order. Use only the
network and device data for the matching test group.
