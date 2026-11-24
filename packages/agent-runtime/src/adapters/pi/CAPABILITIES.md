# PI adapter capabilities

All rows target `@earendil-works/pi-coding-agent@1.4.0`. Tests in
`src/__tests__/pi-plugin.test.ts` run the real npm CLI through a temporary
workspace, a spawn-based sandbox and a local Chat Completions gateway. They
exercise the adapter boundary. Linux nsjail, real gateway and platform tools,
and product acceptance belong to the assembled runtime.

| Id | State | Native behavior and evidence |
| --- | --- | --- |
| `open` | supported | The SDK creates native entries, including the fixed platform tool declarations and engine-tool setting. RPC `get_state` returns the native ID. `--session` resumes the exact file. The opening and import tests verify persistence before the first prompt, missing-file rejection, and the same ID after reopening. |
| `startTurn` | supported | RPC `prompt` invokes the controlled input hook. `agent_settled` ends the run after native work and awaited host events. The tool and gateway tests verify multi-step completion and errors. |
| `messages` | supported | PI message and step hooks preserve order on the same channel as the awaited tool hooks. The plugin keys the two reported message roles at `message_start`. The tool test checks stream deltas, logical steps and tool results. |
| `interrupt` | supported | RPC `clear_queue` followed by `abort` stops the native run. FD cancellation aborts its host invocation. Unresolved calls carry only their IDs at settlement. Tests cancel a platform call and native bash and check for replay and remaining processes. |
| `stopReason` | supported | `agent_settled.aborted` and the last settled assistant `stopReason` determine the run result. Tests cover normal completion, truncation, interruption and a gateway error. |
| `close` | supported | Closing stdin exits the PI process and leaves its session file. The open and import tests reopen the file, and the cancellation test checks that completed history causes no new action. |
| `steer` | supported | RPC `steer` accepts only a live run. Custom messages carry input IDs through the native queue, and PI's `context` hook confirms consumption. The tool test holds execution while steering with duplicate input text and changed context. The cancellation test leaves the queued input unconsumed. |
| `platformTools` | supported | `registerTool` uses the saved declarations. `tool_call` and `tool_result` await the host for both platform and native tools. Tests cover host result and progress, file effects held behind admission, cancellation, and the saved tool surface on reopen. Product sessions receive only platform tools. |
| `gatewayModel` | supported | The extension registers one selected `openai-completions` model with the lease, real context window and configured output limit. The fake gateway checks the path, authorization, model and request payload. |
| `skills` | supported | PI discovers only explicit `--skill` paths in isolated configuration. The skills test puts a competing skill in the project and verifies that the prompt lists only the selected skill. The sandbox owns mount permissions. |
| `usage` | supported | Native counts travel on the settled assistant message. The tool test asserts token counts and no duplicate usage event. |
| `optionalDetails` | supported | RPC compaction and extension errors become process details. The event-mapping test exercises their native frame shapes and entry replacement keys. PI turn and summarization retries are disabled by the same `retry.enabled` setting. The gateway owns request retries. |

## Private channel

FD 3 carries newline-delimited JSON. The plugin sends `init` with directories,
the gateway lease, and either the native reference or first-open state. The
engine reads it before entering PI's CLI. PI RPC stays on stdin and stdout.

The extension sends `request` with an integer `id`, `method`, and `data`.
`event` carries a step or message. `consume` reports input IDs in model-context
order. `steer` reports whether PI queued an input. `toolStart`, `toolUpdate`
and `toolEnd` report the tool lifecycle. `invoke` executes a started platform
tool in the host. A `response` with the same `id` acknowledges the event or
returns the tool result. An `invoke` response of `null` indicates that no
authoritative result arrived. While that request is pending, `progress` carries
host updates and `cancel` carries the native abort signal back to the host.
The extension awaits start and result acknowledgments before proceeding.

Model-directed platform tools use only FD 3. Skill commands continue to use
the sandbox's existing network callback.
