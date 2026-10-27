# PI loop source

Fork source: `@earendil-works/pi-agent-core@1.3.0`, extracted from its published source maps. Upstream: https://github.com/earendil-works/pi/tree/main/packages/agent.

- `agent-loop.ts`: SHA-256 `28a2b03e34a7e32f004aa851e54d3b5be9dad71c392205614cbc9abdf3a9020a` (unmodified source baseline).
- `types.ts`: SHA-256 `2e116ef60fdaca4e26be5a1ace8d8b47f545d648d365de60b8c9f9d1ba629ee4` (unmodified source baseline).
- `stream-fn.ts`: SHA-256 `1f9dee101a5ce1052558458d9ce47e53e05187224e879217899059a80d90bc45` (unmodified source baseline).

Local integration uses the awaited event sink, prepareRequest context hook, sequential tools and an explicit pi-ai stream function. Persistence, private skills and transport projection belong to the enclosing runtime, without host imports. Any source modifications are recorded below.

- Removed the unused pending-message reset and the unused custom-message augmentation point; PrepareNextTurnContext is an equivalent type alias. Wire messages have the closed runtime profile.
