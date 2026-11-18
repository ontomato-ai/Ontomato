# Panel operation intents and human confirmation

Status: approved for implementation with the channel owner's asynchronous-delivery amendments. Channel changes are implemented by P3 and reviewed by that owner before integration. Question UI changes remain with P4.

## Current boundary

Node owns the operation intent, its confirmation association and one dispatch claim. The channel owns generic questions, recipients, persisted answers and truthful provenance. Java owns application admission, product Grants and business execution permissions. The SDK and its client owner own the operation implementation.

The first server operations are `platform:ScheduledTask.save` and `schedules.runNow`. The browser keeps its current human path and credentials; it does not forward an agent's business call or receive executor credentials. A state/navigation operation requires a real addressed instance and acknowledgement; no new instance-dispatch protocol is added for operations the trial does not use.

## Skill-system boundary

Panel skills now use the generic source-provider interface integrated on develop. Java owns their derived identities and page-skill mappings; the Node provider supplies standard domain Agent Skills packages. P3 adds only the operation-command documentation to that existing provider output. It adds no panel catalogue, protected describe/loading endpoint, per-user package or skill-loading branch. Dynamic business data/forms remain the existing owners' interfaces.

## Findings behind the human route

- `agent-runtime/src/channel.ts` already delivers ordinary child `needsInput` to its parent; its no-parent branch already records a question for that conversation's user. Preserve both ordinary clarification behaviors.
- `channel-store.ts:pendingQuestions()` currently selects a question only when its source session equals its receiving session. Simply sending a child's question to the root will not make it a pending human question.
- Existing web replies carry `replyTo`; the runtime constructs their true `source:{kind:'user'}`. Agent sends have the actual execution source. `ShellQuestions` currently sends text, losing the chosen option index.
- `channel.actor.id` is a Java caller reference, not a user ID. Use existing caller restoration for the actual initiator. Do not compare caller UUIDs to user IDs or require caller references to remain identical across human turns.
- `credentialsForRun(owner,runId,initiatorCredentials,sessionId)` rejects a closed or mismatched run and resolves its fixed executor with current credentials. Returned credentials already carry the run caller-scope headers.

## Proposed generic route, for the channel owner

The shapes in `src/agent-user-questions.ts` are private channel transport, not a new business option of the agent tool.

1. Node restores the requesting execution, initiator and actual root from trusted run/admission facts. It reserves a separate server-assigned questionId with the immutable intent (one-to-one per domain), then generates the question from that intent: operation, target, input and execution user. Zero-based option 0 means do not execute and is the default; option 1 means execute this one call. No model-authored confirmation text grants permission.
2. Add a generic nullable `userRecipient` delivery context to trusted run admission/prepare facts: the authenticated human host sets its own receiving session and caller reference, ordinary child admission inherits it, and a source without a verified human recipient keeps null. It is not a model command/context parameter, an executor identity or an intent reference. Node and Java human hosts must both supply it; runtime propagation preserves it rather than inferring human presence from actor.id or an arbitrary root trace. Service-only `POST /v1/channel/user-questions` takes `AgentUserQuestionRequest`. Node allocates a separate questionId and persists its one-to-one association with the intent before delivery; a caller cannot pick or reuse that questionId through an intent ID. Reuse the existing input/admission Idempotency-Key with this server-assigned questionId, so an explicit retry delivers the same question; no new idempotency protocol is added. The channel replay check includes the explicit-user route marker, real source and immutable question payload, so an ordinary clarification cannot be adopted as this question. The body has no arbitrary recipient. For this route the human host declares its own root session, and children inherit it; the channel resolves that trusted userRecipient and checks its receiving scope. Other-root guessing is not supported. An external/background root or missing human session returns `USER_SESSION_UNAVAILABLE`, with no parent-agent substitute.
3. Persist an ordinary `agent-question` in that human session, marked with the generic notification field `recipient:'user'`. Keep its actual child execution as `source`. It is an output/notification, not a pending model input that would make the root answer its own question. Return `AgentUserQuestionReceipt` and emit the existing question/session updates.
4. Extend `pendingQuestions()` to include explicitly user-addressed questions. Such a question is answered only by the real human receipt in its receiving session. Agent/external answers must neither approve nor remove it from the user's list. The source execution's `questions()` view uses the same receiving question/answer facts.
5. Put this authoritative pending-question list into the existing long-lived agent-tasks session snapshot and stream, keeping the stream open while a user question is pending. The root's last run may already have finished, so live display must not depend only on that run's stream or client-loaded history. Initial/history and session updates reuse the same owner query. No new question table, UI component or polling is added.
6. Add optional `selectedOption` and the host-derived respondent caller reference to the existing authenticated human send/reply path and persisted answer; never reconstruct a past respondent from the latest session binding. The host supplies the respondent caller from verified identity. Validate the index against the stored options; absent selection is free text, not approval. Include selection in existing input-ID replay/conflict checks, so a request cannot reuse one input ID with another choice.
7. After persistence and outside the receiving session lock, forward this same ordinary `agent-answer` to the questioning conversation, retaining `source:{kind:'user'}`, `replyTo`, `selectedOption`, the authenticated respondent and the original `answerId`. Use the existing delivery path: a running conversation consumes it at a safe boundary; an idle conversation starts a new run. Do not add a provider action, waiter, polling or second delivery path. The question's default/free text has no approval meaning in the channel.
8. Private `GET /v1/channel/user-questions/:questionId/answers/:answerId` returns `AgentQuestionAnswerReceipt` from persisted input, scoped to the participating host/tree and domain. Node finds the authoritative answer in the channel's question projection, then reads the receipt rather than trusting a skill's claimed answer. This is evidence read, not another authorization route.

Question/answer provenance remains the original user/agent/external fact; consuming an operation authorization does not write or overwrite business confirmedDecisions. Forwarding uses the authenticated human input credential and the existing host preparation path, never executor credentials. A human reply may use another caller reference; Node restores both through the existing caller owner and compares the actual initiator user/domain. It does not put executor identity/keys into generic question metadata or borrow the reply's browser credential for an old run.

### Edits to agree before implementation

| Location | Change | Ownership |
| --- | --- | --- |
| `contracts/src/agent-channel.ts`, `agent-host.ts` | Integrate the nullable admission/prepare userRecipient, selection and verified respondent/receipt fields; no panel intent ID in the channel protocol. | Channel owner review. |
| `contracts/src/agent-tasks.ts`, host task/session projections | Add the authoritative pending-question list to session updates, including after root-run completion. | Channel owner. |
| `agent-runtime/src/channel-store.ts` | User-recipient pending/answered predicates and scoped answer receipt read, using existing messages. | Channel owner. |
| `agent-runtime/src/channel.ts`, `http.ts` | Resolve human root, private delivery/read routes, true answer persistence and ordinary agent-answer forwarding. Preserve admission, sealing and ordinary needsInput. | Channel owner. |
| Node `services/agent-host/channel.ts`, `api/routes/agent-channel.ts` | Carry trusted recipient/selection and expose channel receipt reads; no additional provider action. | P3 after agreement. |
| Node `assistant/service.ts`; Java `controller/AgentChannelController.java` human host path | Carry selectedOption and verified respondent from the authenticated human entry, not request-supplied provenance. | Host/channel owner coordination. |
| `agent-shell-ui/src/components/ShellQuestions.vue`, `context.ts`, `useAgentConversation.ts`, send adapters | Forward the chosen index through the existing answer port and apply session pending-question snapshots. No second confirmation UI. | P4 executor, using this contract. |

The recipient schema lives only in `agent-channel.ts`; the private transport imports it. `agentHostSendRequestSchema.selectedOption` is the zero-based option index P4 forwards from `ShellQuestions`. P4 applies `AgentTasksSnapshot.pendingQuestions` to the existing question list; session history/snapshot remain authoritative on reconnect. A free-text send omits the index. Hosts derive respondent from authentication. No UI path sends an approval boolean or provenance. No runtime branch interprets an operation, executor or business decision.

## Node intent and one dispatch

`PanelOperationIntent` is one minimum invocation fact in the existing Node product service: questioning session and original question run for provenance, root session, use reference, resolved panel/projection/binding/operation, immutable call, actual initiator, fixed executionUserId, questionId/answer provenance, dispatched and owner outcome. Answer text remains in the channel; Node does not duplicate it. It has no credential, signature, frozen revision or workflow transitions.

- Resolve the current Java use and panel/projections through their existing admission/use owners. Resolve operationId from the current manifest slots/projections and the same-version SDK catalogue/port derivation shared with the SDK; never parse labels/HTML or execute module text. Validate the supplied target type against that declaration, leaving business access to its owner. Do not create a second skill/menu permission calculator or a Node class-permission list.
- Do not accept handlerRef, executor, root setting, questionId or an answer receipt from a skill. A new invocation gets a new intentId and Node-owned question association (unique per domain); toolCallId is trace data, never authorization. Reusing an intent ID with different target, input or source is a conflict requiring a new intent.
- Node owns one confirmation boolean per `(domain,root provider,root session)` and its restored owner. No row means confirmation on. Initialize from trusted admission/root ownership, not model-selected roots. Only the authenticated owning user's UI path may update it, using the existing owning-provider exact session-owner check, not administrator/maintainer or merely readable-session access. Children use that same root setting.
- Settings affect new intents. Turning automatic mode on neither executes an old pending question nor saves a draft. A new session defaults to confirmation on.
- Default form.save produces the existing unsaved PageDraft only. Its form holds the owner's field values, with the relation's pageKey and derived save operation. The standard skill script writes the existing draft artifact and link; no business write or redeemable chat save confirmation is created.
- Default runNow creates the human question above. Only option 1 on its linked persisted question, from the authenticated initiating human in the actual recipient session, approves. Free text, defaults, skip/timeout, parent answers and possession of questionId do not approve.
- `operate` returns confirmation-required and intentId immediately; the tool finishes and the agent can continue or end its run. The human answer arrives through ordinary agent-answer and can wake a new run. The agent then explicitly calls dispatch(intentId).
- Dispatch binds to the same questioning session and fixed executionUserId, not the original runId. Call credentialsForRun for the CURRENT authenticated run, compare its executor with the intent, resolve the current operation/binding and read the linked real-human answer receipt. Changed target/input, executor or operation requires a new intent. An ended source run does not invalidate the intent. A current run must be live to obtain its executor; RUN_CLOSED never means the historical question run merely ended.
- Atomically claim dispatched=false to true before the owner call. Never reset it on refusal or unknown outcome. Repeated tool/dispatch calls return the recorded fact without invoking again. No tool call waits for a human, and no request-lifetime waiter is created.
- Automatic mode makes an explicit save/run call through the same owner path, without a question. It does not bypass authorization. runNow uses the task service's existing Idempotency-Key with intentId. An unknown result is reported/inspected, not released for replay.

### Node API shapes

These are operation APIs, not skill publication, catalogue or loading APIs. Their caller context comes from the existing fixed execution callback, retaining its GET/POST/run/path restrictions. The questioning session is restored from the current owned run, never selected in the body, and must match the stored invocation for dispatch. Reading an existing intent is an initiator-owned data read, independent of original-run liveness or executor key validity.

| Method/path | Body | Result |
| --- | --- | --- |
| `POST /api/assistant/executions/:runId/panels/operate` | CreatePanelOperationIntentRequest | PanelOperateResponse |
| `GET /api/panel-operation-intents/:intentId` | No body; authenticated initiator owner | PanelOperationIntent; no executor recovery |
| `POST .../panels/intents/:intentId/dispatch` | Empty object | PanelOperateResponse; only the stored call can dispatch |
| `GET /api/panel-operation-settings/:providerId/:sessionId` | Authenticated owning human, no body | PanelOperationSettings |
| `PUT` same settings path | UpdatePanelOperationSettingsRequest | PanelOperationSettings |

Use direct fixed coordinator handlers under the existing `/api/assistant/executions/:runId/` sealed callback prefix, not the general workbench/ontology business proxy: that proxy switches to executor credentials, whereas product admission must keep initiator. `unwrapCallbackCredential` restores the initiator and checks run/path/expiry; coordinator routes require that callback context, and use credentialsForRun only for the nested owner call. The Node host issues the existing sealed callback capability and a coordinator URL in the run environment in both self and specified-user modes; this changes no skill loading and exposes no executor key. The ordinary intent GET is also available to scripts through the existing workbench ownership-read proxy, classified as initiator data before executor resolution; it never dispatches or calls credentialsForRun. Settings routes are excluded from skill callback credentials. Question delivery and receipt reads are service-only, not public approval endpoints. Intent lookup does not revive a run; the existing channel delivery alone wakes the questioning session. There is no provider answer callback.

## Shared operation implementation and execution identity

The SDK's current ScheduledTask code already gets a task and its owner form, sends update at the caller-supplied revision and runs now through createSchedulesApi. Move that request orchestration to a pure client module in the existing platform-schedules package, then call it from both SDK and Node with explicit request ports. Browser registry/import changes go to P4's file owner. Node uses only the fixed save/run operations with credentialsForRun's executor/caller headers; there is no model-supplied URL or browser forwarding.

Keep the revision read when a form/draft was obtained. Fetching unchanged task fields or the owner's formRevision before update must not replace that supplied task revision with the latest value. Preserve the owner's refusal and structured form errors and the complete C-package caller headers. Carry the run's actual authority/build-test context; absent client headers cannot turn a test run into live execution, and an unsupported management-write test context is refused. Any added workspace dependency updates public and enterprise lockfiles together.

The old PLATFORM_DRAFT_RULE must not forbid the declared operation entry. Scope it to direct writes from unconverted hand-written page skills, and explain read / unsaved form draft / declared coordinated operation for panel operations. Existing manual scripts keep their guards. Do not identify a universal panel skill or change package loading to do this; the coordinator's actual declared-operation boundary is what permits a call.

## Review and evidence

This contract amendment is committed before implementation and reported to the main controller; implementation continues under its authorization. The channel-owned files are listed separately for owner review before integration. P4 owns the existing question UI and selectedOption/session-snapshot adapters.

Retain unit-test evidence for child request/parent non-approval; a real initiator answer and exactly one dispatch across run/tool-call retries; changed calls requiring another intent; current-run credential selection and executor mismatch; denied executor without initiator fallback; default unsaved draft and automatic explicit save/run. Run the requested pr-checks commands individually and the enterprise ci-test script after implementation, with every exit code recorded. No local full stack or 128 work is included here.
