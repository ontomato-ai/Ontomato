# PI loop source

Fork source: `@earendil-works/pi-agent-core@1.4.0`, extracted from the exact npm
package's published JavaScript source maps. Upstream:
https://github.com/earendil-works/pi/tree/main/packages/agent.

- `agent-loop.ts`: SHA-256 `9d7589b5071ea3b8b3e3c624f9cfc09a976ebf7436024a58213837de4645167d` (unmodified upstream source).
- `types.ts`: SHA-256 `2e116ef60fdaca4e26be5a1ace8d8b47f545d648d365de60b8c9f9d1ba629ee4` (unmodified upstream source).
- `stream-fn.ts`: SHA-256 `1f9dee101a5ce1052558458d9ce47e53e05187224e879217899059a80d90bc45` (unmodified upstream source).

Re-forked from 1.4.0 on 2026-10-28, retaining the upstream MIT license in LICENSE.
The upstream loop already provides an awaited event sink, prepareRequest and
sequential tools. Runtime integration uses those hooks for durable journaling,
event sequence assignment, compaction and termination; it does not replace them
with fire-and-forget callbacks. Those integrations remain in runtime.ts/store.ts.
Upstream 1.4.0 adds client identity/attribution merging; it is retained.

Local source changes:
- types.ts closes the unused custom-message augmentation point to the shared PI
  conversation profile, and uses an equivalent PrepareNextTurnContext type alias.
- agent-loop.ts removes the unused pendingMessages reset (the next assignment
  overwrites it), as in the previous integration, to satisfy no-useless-assignment.
- stream-fn.ts is unmodified 1.4.0 source.

Both pi-ai and pi-coding-agent dependencies are exactly 1.4.0. Skills use the
upstream tool factories; host persistence and transport projection remain outside
the fork. Model, reasoning-content, compaction and recovery behavior require the
real-process regression suite; the source comparison alone is not acceptance.
