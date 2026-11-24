# Codex CLI 0.171.0

The adapter uses experimental stdio app-server JSON-RPC. The R14 fixture is a
reduced recording of the pinned program with IDs and timestamps normalized.
The native compatibility test runs in CI with a real program, PostgreSQL and
a deterministic local Responses endpoint. Deployment acceptance runs separately.

| Capability | State | Evidence and boundary |
| --- | --- | --- |
| open | Supported | `thread/start` with fixed declarations, `thread/resume` with the stored ID and the same native state. The runtime retains existing PI bindings. |
| startTurn | Supported | `turn/start` carries the single opening receipt used by the runtime plus text, images and per-turn context. The upstream request has a single client receipt field. |
| messages | Supported | Item-based message and tool lifecycle, reasoning and text deltas, complete item content and observable logical steps. |
| interrupt | Supported | `turn/interrupt`, then `thread/backgroundTerminals/clean`. Cancelled dynamic calls without host results stay unsettled even when Codex emits a failed item. |
| stopReason | Limited | Maps normal final output, tool-only completion, interruption and failure. The typed terminal fields observed in R14 do not convey a reliable provider length-stop reason. |
| close | Supported | Stops the sandbox process and awaits its exit. The owner releases the sandbox and lease. |
| steer | Supported | Sends `expectedTurnId` and `clientUserMessageId`. Reports consumption from the completed `userMessage.clientId`, after tool outputs where observed. |
| platformTools | Supported | Only the server request invokes the owner. The item stream shows results and progress. Tool declarations survive native restart. |
| gatewayModel | Supported | The configured OpenAI Responses endpoint and authorized model are from the runtime lease. Upstream-specific behavior remains a deployment check. |
| skills | Unverified | Managed home exposes selected read-only mounts as skill roots. Version-isolated script execution requires the assembled sandbox. |
| usage | Supported | Last and cumulative token usage are emitted with the native turn association and no inferred message attribution. |
| optionalDetails | Limited | Translates file changes, compaction, model reroutes and diagnostics. Unsupported native interfaces and optional events have no platform behavior. |

Production uses the isolated fixed configuration and a generated single-model
catalog. The product tool surface disables shell tools and omits the native
patch tool from that catalog. Built-in skills, agents, update_plan, web search,
plugins, and native MCP are disabled. The adapter leaves collaboration in Default.
