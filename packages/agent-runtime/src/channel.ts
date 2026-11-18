import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import { z } from "zod";
import { agentChannelCommandSchema, agentDeliverySchema, agentProviderAcknowledgementSchema, agentSteerPreparationSchema, agentDirectorySchema, type AgentRunIntent, type AgentRunContext, type AgentExecutionRef, type AgentSessionRef, type AgentInput, type AgentNotification, type AgentPrepareRequest, type AgentActorRef, type AgentCredential, type AgentInputDelivery } from "@ontomato/contracts/agent-channel";
import type { AgentUserQuestionRequest } from "@ontomato/contracts/agent-user-questions";
import { isDirectUserRun, MID_ROUND_RESULT_NOTIFICATION_FACT } from "@ontomato/contracts/agent-visibility";
import type { PresentationBinding } from "@ontomato/contracts/agent-presentation";
import { runtimeStartRunRequestSchema, type RuntimeRun } from "@ontomato/contracts/agent-runtime";
import type { RuntimeMessage } from "@ontomato/contracts/agent-runtime-messages";
import type { AgentTask,QualityResult } from "@ontomato/contracts/agent-tasks";
import type { Message } from "@earendil-works/pi-ai";
import type { AgentTool } from "./core/pi/types";
import type { AgentRuntime } from "./runtime";
import type { Scope, MessageRow } from "./store";
import { ChannelStore } from "./channel-store";
import { RuntimeError, safeMessage } from "./errors";
import { runtimeLogger, runtimeDiagnostic } from "./logging";

export interface ExternalAgentCaller { kind:"external";actor:AgentActorRef;authority:AgentRunContext["authority"];language:string;credential:AgentCredential }
export interface AgentProvider { id: string; hostId: string; url: string; token: string }
type Listener = () => void;
export class AgentChannel {
  readonly facts: ChannelStore;
  /** PI returns the same queued object; preserve its receipt identity in the event sink. */
  readonly inputIds = new WeakMap<object, string>();
  private listeners = new Map<string, Set<Listener>>();
  private chains = new Map<string, { credential: AgentCredential; executions: Set<string>; presentationBinding?: PresentationBinding }>();
  private chainKey(channel: AgentRunContext) { return JSON.stringify([channel.actor.domainId,channel.root.session.providerId,channel.root.session.sessionId,channel.root.runId]); }
  remember(channel: AgentRunContext, credential: AgentCredential, presentationBinding?: PresentationBinding) {
    this.chains.set(this.chainKey(channel), { credential, executions: this.chains.get(this.chainKey(channel))?.executions ?? new Set(), presentationBinding });
  }
  /** A direct admission may wait for the previous run to finish sealing. Its binding is consumed once. */
  private takePresentationBinding(intent: AgentRunIntent) {
    if (intent.id !== intent.channel.root.runId) return;
    const chain = this.chains.get(this.chainKey(intent.channel));
    const binding = chain?.presentationBinding;
    if (chain) delete chain.presentationBinding;
    return binding;
  }
  credential(channel: AgentRunContext) {
    const chain = this.chains.get(this.chainKey(channel));
    if (!chain) throw new RuntimeError(401,"CALLER_CREDENTIAL_INVALID","The initiating credential is no longer available; please start again");
    return chain.credential;
  }
  private retain(intent: AgentRunIntent) {
    if (!intent.cancelled) this.chains.get(this.chainKey(intent.channel))?.executions.add(intent.id);
  }
  private release(intent: AgentRunIntent) {
    const key = this.chainKey(intent.channel), chain = this.chains.get(key);
    if (!chain) return;
    chain.executions.delete(intent.id);
    if (!chain.executions.size) this.chains.delete(key);
  }
  constructor(readonly runtime: AgentRuntime) { this.facts = new ChannelStore(runtime.store); }
  provider(id: string) {
    const provider = this.runtime.options.agentProviders?.find(p => p.id === id);
    if (!provider) throw new RuntimeError(404, "PROVIDER_NOT_REGISTERED", "Agent provider is not registered");
    return provider;
  }
  scope(ref: AgentSessionRef, domainId: string): Scope { return { hostId: this.provider(ref.providerId).hostId, domainId }; }
  private async post(port: { url: string; token: string }, path: string, body: unknown, domainId: string, credential?: AgentCredential) {
    const response = await fetch(port.url.replace(/\/$/, "") + path, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(30000), headers: { "Content-Type": "application/json", "X-Ontomato-Query-Service-Token": port.token, "X-Domain-Id": domainId, ...(credential?.token ? {tk:credential.token} : {}), ...(credential?.apiKey ? {"X-API-Key":credential.apiKey} : {}) },
      body: JSON.stringify(body),
    });
    if (response.status === 401) throw new RuntimeError(401,"CALLER_CREDENTIAL_INVALID","The initiating credential is invalid or expired; please start again");
    const value = await response.json();
    if (!response.ok) {
      const failure = z.object({ error: z.object({ code: z.string(), message: z.string() }) }).parse(value);
      throw new RuntimeError(response.status, failure.error.code, failure.error.message);
    }
    return value;
  }
  private executionActor(intent: AgentRunIntent) {
    return intent.executionUserId ? {userId:intent.executionUserId,domainId:intent.channel.actor.domainId} : null;
  }
  async file(intent:AgentRunIntent,fileId:string) {
    const provider=this.provider(intent.session.providerId);
    const response=await fetch(provider.url.replace(/\/$/u,"")+"/read",{method:"POST",redirect:"error",signal:AbortSignal.timeout(30000),headers:{"Content-Type":"application/json",Accept:"application/octet-stream","X-Ontomato-Query-Service-Token":provider.token,"X-Domain-Id":intent.channel.actor.domainId},body:JSON.stringify({execution:{session:intent.session,runId:intent.id},actor:intent.channel.actor,executionActor:this.executionActor(intent),fileId})});
    if(!response.ok) { const failure=z.object({error:z.object({code:z.string(),message:z.string()})}).parse(await response.json());throw new RuntimeError(response.status,failure.error.code,failure.error.message); }
    return response;
  }
  async callback(intent: AgentRunIntent, action: "settle" | "read" | "cancel") {
    const value = await this.post(this.provider(intent.session.providerId), "/" + action, { execution: { session: intent.session, runId: intent.id }, actor: intent.channel.actor, executionActor: this.executionActor(intent) }, intent.channel.actor.domainId);
    return action === "read" ? value : agentProviderAcknowledgementSchema.parse(value);
  }
  private emitChange(scope: Scope, sessionId: string) { for (const listener of this.listeners.get(JSON.stringify([scope,sessionId])) ?? []) listener(); }
  private async announce(intent: AgentRunIntent) {
    const domain=intent.channel.actor.domainId;
    const sessions=new Map<string,AgentSessionRef>();
    const add=(session:AgentSessionRef)=>sessions.set(JSON.stringify([session.providerId,session.sessionId]),session);
    add(intent.session);add(intent.channel.root.session);
    let parent=intent.channel.requestedBy;
    while(parent) { add(parent.session);parent=(await this.facts.intent(this.scope(parent.session,domain),parent.runId)).channel.requestedBy; }
    for(const session of sessions.values()) this.emitChange(this.scope(session,domain),session.sessionId);
  }
  subscribe(scope: Scope, sessionId: string, listener: Listener) {
    const id = JSON.stringify([scope,sessionId]), set = this.listeners.get(id) ?? new Set<Listener>();
    set.add(listener); this.listeners.set(id, set);
    return () => { set.delete(listener); if (!set.size) this.listeners.delete(id); };
  }
  async request(scope: Scope, sessionId: string, runId: string, channel: AgentRunContext, input: AgentInput, language: string, context: AgentRunIntent["context"] | undefined, credential: AgentCredential, inheritedExecutionUserId?:string|null, presentationBinding?: PresentationBinding) {
    if (scope.domainId !== channel.actor.domainId || this.provider(channel.agent.providerId).hostId !== scope.hostId)
      throw new RuntimeError(403, "CROSS_DOMAIN", "Agent identity and target must belong to the current domain and provider");
    if (input.role === "notification" && input.kind === "agent-answer" && input.replyTo) {
      const question = await this.facts.question(scope.domainId,input.replyTo);
      if (question.recipient === "user") return this.answerUserQuestion(scope,sessionId,runId,channel,input,credential);
    }
    const accepted=await this.accept({providerId:channel.agent.providerId,sessionId},channel.actor,input,{steer:true,web:{runId,channel,language,context,credential,executionUserId:inheritedExecutionUserId,
      presentationBinding: input.role === "user" && channel.requestedBy === null && channel.userRecipient ? presentationBinding : undefined}});
    return {...accepted,delivery:accepted.delivery!};
  }
  /** Service-only explicit human route, separate from an agent's ordinary needsInput command. */
  async userQuestion(scope: Scope, questionId: string, body: AgentUserQuestionRequest) {
    const sourceScope = this.scope(body.source.session,scope.domainId);
    if (sourceScope.hostId !== scope.hostId) throw new RuntimeError(403,"FORBIDDEN","Question source belongs to another provider");
    const intent = await this.facts.intent(sourceScope,body.source.runId);
    if (intent.session.sessionId !== body.source.session.sessionId) throw new RuntimeError(403,"FORBIDDEN","Question source session differs");
    const recipient = intent.channel.userRecipient;
    if (!recipient) throw new RuntimeError(409,"USER_SESSION_UNAVAILABLE","Execution has no authenticated human recipient");
    const targetScope = this.scope(recipient.session,scope.domainId);
    if (recipient.actor.domainId !== scope.domainId) throw new RuntimeError(403,"CROSS_DOMAIN","Human recipient belongs to another domain");
    const question: AgentNotification = {role:"notification",kind:"agent-question",recipient:"user",source:body.source,
      content:body.message,defaultAssumption:body.defaultAssumption,options:body.options,timestamp:Date.now()};
    await this.runtime.locked(targetScope,recipient.session.sessionId,async () => {
      const previous = await this.facts.receipt(targetScope,questionId);
      if (previous) {
        const message = previous.message;
        if (previous.sessionId !== recipient.session.sessionId || message.role !== "notification" || message.recipient !== "user" ||
          JSON.stringify(message.source) !== JSON.stringify(body.source) || message.content !== question.content ||
          message.defaultAssumption !== question.defaultAssumption || JSON.stringify(message.options) !== JSON.stringify(question.options))
          throw new RuntimeError(409,"IDEMPOTENCY_CONFLICT","User question changed");
        return;
      }
      await this.facts.receive(targetScope,recipient.session.sessionId,question,{id:questionId,outputRunId:intent.channel.root.runId});
    });
    await this.runtime.questionsChanged(targetScope,recipient.session.sessionId);
    this.emitChange(targetScope,recipient.session.sessionId);
    return {questionId,source:body.source,recipient};
  }
  /** Store once in the human conversation, then deliver only to the questioning conversation. */
  private async answerUserQuestion(scope: Scope, sessionId: string, inputId: string, channel: AgentRunContext, input: AgentNotification, credential: AgentCredential) {
    const question = await this.facts.userQuestion(scope.domainId,input.replyTo!);
    if (question.scope.hostId !== scope.hostId || question.sessionId !== sessionId)
      throw new RuntimeError(400,"INVALID_REPLY","Question was addressed to another human conversation");
    const source = question.record.message.source as AgentExecutionRef;
    const origin = await this.facts.intent(this.scope(source.session,scope.domainId),source.runId);
    let replayed = false;
    const received = await this.runtime.locked(scope,sessionId,async () => {
      const previous = await this.facts.receipt(scope,inputId);
      if (previous) {
        const message = previous.message as AgentNotification;
        if (previous.sessionId !== sessionId || message.role !== "notification" || message.kind !== "agent-answer" || !("kind" in message.source) || message.source.kind !== "user" || message.replyTo !== input.replyTo || message.content !== input.content || message.selectedOption !== input.selectedOption)
          throw new RuntimeError(409,"IDEMPOTENCY_CONFLICT","Human answer changed");
        replayed = true;
        return previous;
      }
      if (!(await this.facts.pendingQuestions(scope,sessionId)).some(q => q.requestId === input.replyTo))
        throw new RuntimeError(400,"INVALID_REPLY","Question already has a human answer");
      if (input.selectedOption !== undefined && !question.record.message.options?.[input.selectedOption])
        throw new RuntimeError(400,"INVALID_REPLY","Selected option is outside the question");
      return this.facts.receive(scope,sessionId,{...input,source:{kind:"user"},respondent:channel.actor},{id:inputId,outputRunId:question.record.runId});
    });
    await this.runtime.questionsChanged(scope,sessionId);
    this.emitChange(scope,sessionId);
    // Existing transport credentials are scoped to this live delivery; no executor key or new credential store.
    this.remember(origin.channel,credential);
    await this.deliver(source.session,channel.actor,{...received.message as AgentNotification,answerId:received.id},{steer:true});
    return {input:received,replayed,pendingQuestions:await this.facts.pendingQuestions(scope,sessionId),
      delivery:{messageId:received.id,sessionRef:{providerId:channel.agent.providerId,sessionId},runId:question.record.runId,delivery:"receipt" as const,status:"completed" as const}};
  }
  async prepare(intent: AgentRunIntent) {
    const scope = this.scope(intent.session, intent.channel.actor.domainId);
    const presentationBinding = this.takePresentationBinding(intent);
    let hostPrepared = false;
    try {
      const input = (await this.facts.pending(scope, intent.session.sessionId)).find(row => row.id === intent.inputId)!.message as AgentInput;
      const parent = intent.channel.requestedBy;
      const inheritedExecution = intent.executionUserId!==undefined ? this.executionActor(intent) : parent ? this.executionActor(await this.facts.intent(this.scope(parent.session, scope.domainId), parent.runId)) : null;
      const request: AgentPrepareRequest = { mode: "run", executionActor: inheritedExecution, language: intent.language, agent: intent.channel.agent, sessionId: intent.session.sessionId, runId: intent.id, actor: intent.channel.actor, inputId: intent.inputId, input, authority: intent.channel.authority, requestedBy: intent.channel.requestedBy, root: intent.channel.root, userRecipient: intent.channel.userRecipient ?? null, context: intent.context, presentationBinding };
      const { presentationCallback, ...prepared } = runtimeStartRunRequestSchema.parse(
        await this.post(this.provider(intent.session.providerId), "/prepare", request, scope.domainId, this.credential(intent.channel)));
      hostPrepared = true;
      intent.executionUserId = prepared.executionActor?.userId ?? null;
      await this.runtime.locked(scope, intent.session.sessionId, async () => {
        const current = await this.facts.intent(scope, intent.id);
        current.executionUserId = intent.executionUserId;
        await this.facts.update(scope, current);
      });
      const authority = prepared.authority ?? intent.channel.authority;
      const inherited = intent.channel.authority;
      if (inherited.executionKind === "build-test" && authority.executionKind !== "build-test") throw new RuntimeError(403,"BUILD_TEST_FORBIDDEN","A provider cannot change build-test authority to live");
      if (inherited.executionContextId && authority.executionContextId !== inherited.executionContextId) throw new RuntimeError(403,"BUILD_TEST_FORBIDDEN","A provider cannot change the delegated execution context");
      if (inherited.classNames.length && (!authority.classNames.length || authority.classNames.some(name => !inherited.classNames.includes(name)))) throw new RuntimeError(403,"SCOPE_EXPANDED","A provider cannot expand the delegated class scope");
      const channel = { ...intent.channel, authority };
      const host = this.runtime.options.hosts.find(host => host.id === scope.hostId)!;
      await this.runtime.start(host, scope, intent.session.sessionId, intent.id, intent.id, {
        ...prepared, language: intent.language, input, channel,
        presentationCallback: presentationBinding ? presentationCallback : undefined,
      }, true);
      await this.announce(intent);
    } catch (error) {
      const modelOnly=await this.runtime.locked(scope,intent.session.sessionId,async()=>{
        const current=await this.facts.intent(scope,intent.id);
        if(!current.cancelled || current.cancelMode!=="model") return false;
        current.status="cancelled";current.error=null;await this.facts.update(scope,current);return true;
      });
      if(modelOnly) { await this.notify(scope,intent.id);return; }
      let failure = safeMessage(error);
      if (hostPrepared) {
        try { await this.callback(intent,"cancel"); }
        catch (closing) { failure += `; host cancellation failed: ${safeMessage(closing)}`; }
      }
      await this.runtime.locked(scope, intent.session.sessionId, async () => {
        const current = await this.facts.intent(scope, intent.id);
        current.status = current.cancelled ? "cancelled" : "failed";
        current.error = failure;
        await this.facts.update(scope, current);
      });
      await this.announce(intent);
      await this.notify(scope,intent.id,true);
      throw error;
    }
  }
  private launch(intent: AgentRunIntent) {
    if (intent.cancelled) return;
    void this.prepare(intent).catch(error => runtimeLogger.error("Agent preparation failed", runtimeDiagnostic(error)));
  }
  /** All inputs share receipt, admission and safe-boundary consumption. */
  private async accept(target: AgentSessionRef, actor: AgentRunContext["actor"], input: AgentInput, options: {
    requestedBy?: AgentExecutionRef; resultRecipientRunId?: string; steer?: boolean; external?: ExternalAgentCaller;
    web?: {runId:string;channel:AgentRunContext;language:string;context:AgentRunIntent["context"];credential:AgentCredential;executionUserId?:string|null;presentationBinding?:PresentationBinding};
  } = {}) {
    const {requestedBy,resultRecipientRunId,steer=false,external,web}=options, scope=this.scope(target,actor.domainId);
    let launch: AgentRunIntent | undefined;
    const accepted=await this.runtime.locked(scope,target.sessionId,async (): Promise<{delivery:AgentInputDelivery | null;input:MessageRow;replayed:boolean}> => {
      if(input.role === "notification" && input.kind === "agent-result" && "session" in input.source) {
        const delivered=await this.facts.delivered(scope,target.sessionId,input.source);
        if(delivered) return {input:(await this.facts.receipt(scope,delivered))!,delivery:null,replayed:true};
      }
      if(web) {
        const original=await this.facts.receipt(scope,web.runId);
        if(original) {
          const message=original.message as AgentInput;
          if(original.sessionId!==target.sessionId || message.role!==input.role || message.content!==input.content || (message.role==="notification" ? message.replyTo : undefined)!==(input.role==="notification" ? input.replyTo : undefined) || (message.role==="notification" ? message.selectedOption : undefined)!==(input.role==="notification" ? input.selectedOption : undefined)) throw new RuntimeError(409,"IDEMPOTENCY_CONFLICT","Input changed");
          const intent=await this.facts.intent(scope,original.runId ?? original.intentId!);
          if(intent.status === "failed" || intent.cancelled) throw new RuntimeError(409,"RUN_CLOSED",intent.error ?? "Execution intent is closed");
          return {input:original,replayed:true,delivery:{messageId:original.id,sessionRef:target,runId:intent.id,delivery:intent.inputId===original.id?"run":"steer",status:intent.status==="starting"?"starting":"running"}};
        }
      }
      const binding=await this.facts.binding(scope,target.sessionId);
      if(binding.actor.domainId!==actor.domainId) throw new RuntimeError(403,"CROSS_DOMAIN","Cross-domain messages are forbidden");
      if(web && binding.agent.agentId!==web.channel.agent.agentId) throw new RuntimeError(409,"AGENT_CHANGED","Session belongs to another agent");
      const session=await this.runtime.store.session(scope,target.sessionId), preparing=await this.facts.preparing(scope,target.sessionId);
      if((session.activeRunId || preparing) && input.role==="notification" && input.kind==="agent-message" && !steer) throw new RuntimeError(409,"SESSION_BUSY","Use steer to insert an ordinary message into a running session");
      if(web && input.role==="notification" && input.replyTo && !(await this.facts.pendingQuestions(scope,target.sessionId)).some(question=>question.requestId===input.replyTo)) throw new RuntimeError(400,"INVALID_REPLY","replyTo must identify a pending question for this conversation's user");
      const openRun=session.activeRunId && this.runtime.acceptsInput(scope,session.activeRunId) ? session.activeRunId : null;
      const existingRun=openRun ?? preparing;
      const received=await this.facts.receive(scope,target.sessionId,input,{mode:steer || (input.role==="notification" && input.replyTo)?"steer":"followup",...(web?{id:web.runId}:{}),intentId:existingRun ?? undefined});
      if(existingRun) {
        if(openRun) await this.runtime.inputReceived(scope,openRun,received);
        return {input:received,replayed:false,delivery:{messageId:received.id,sessionRef:target,runId:existingRun,delivery:"steer",status:openRun?"running":"starting"}};
      }
      const previous = web ? null : resultRecipientRunId
        ? await this.facts.intent(scope,resultRecipientRunId)
        : await this.facts.latest(scope,target.sessionId);
      const sender=input.role === "notification" && "session" in input.source ? await this.facts.intent(this.scope(input.source.session,scope.domainId),input.source.runId) : null;
      if(sender?.cancelled || (previous?.cancelled && !requestedBy && !external)) return {input:received,delivery:null,replayed:false};
      const runId=web?.runId ?? randomUUID();
      const requesterRun=requestedBy ? (await this.runtime.store.run(this.scope(requestedBy.session,actor.domainId),requestedBy.runId)).run : null;
      const requester=requesterRun?.channel;
      const channel:AgentRunContext=web?.channel ?? {agent:binding.agent,actor:requestedBy || external || (input.role === "notification" && "kind" in input.source && input.source.kind === "user") ? actor : previous!.channel.actor,authority:external?.authority ?? requester?.authority ?? previous!.channel.authority,
        requestedBy:external?null:requestedBy ?? previous!.channel.requestedBy,root:external?{session:target,runId}:requester?.root ?? previous!.channel.root,
        userRecipient:external ? null : requester?.userRecipient ?? previous?.channel.userRecipient ?? null};
      const intent = await this.facts.reserve(scope,target.sessionId,runId,received.id,channel,{
        language:web?.language ?? external?.language ?? requesterRun?.language ?? previous!.language,
        context:resultRecipientRunId ? previous!.context : web?.context ?? binding.context,
        executionUserId:web ? web.executionUserId : external ? null : requesterRun ? requesterRun.executionUserId : previous?.executionUserId,
        afterRunId:session.activeRunId ?? undefined,
      });
      if((web || external) && channel.root.runId===runId)
        this.remember(channel,web?.credential ?? external!.credential,web?.presentationBinding);
      this.retain(intent);
      if(!session.activeRunId) launch=intent;
      return {input:received,replayed:false,delivery:{messageId:received.id,sessionRef:target,runId,delivery:"run",status:"starting"}};
    });
    this.emitChange(scope,target.sessionId);
    if(launch) {
      if(web) { await this.prepare(launch);accepted.delivery!.status="running";accepted.input=(await this.facts.receipt(scope,accepted.input.id))!; }
      else this.launch(launch);
    }
    if(input.role==="notification" && input.kind==="agent-answer") await this.runtime.questionsChanged(scope,target.sessionId);
    const {id,runId,messageSeq,contextSeq,message}=accepted.input;
    return {...accepted,input:{id,runId,messageSeq,contextSeq,message},pendingQuestions:await this.facts.pendingQuestions(scope,target.sessionId)};
  }
  async deliver(target: AgentSessionRef, actor: AgentRunContext["actor"], input: AgentNotification, options:{requestedBy?:AgentExecutionRef;resultRecipientRunId?:string;steer?:boolean;external?:ExternalAgentCaller}={}) {
    const accepted=await this.accept(target,actor,input,options);
    return {messageId:accepted.input.id,taskId:accepted.delivery?.delivery==="run"?accepted.delivery.runId:null,sessionRef:target};
  }
  /** Called while holding the same session lock as store.finish. No callback is made here. */
  async nextLocked(scope: Scope, run: RuntimeRun): Promise<AgentRunIntent | undefined> {
    if (!run.channel) return;
    const intent = await this.facts.intent(scope, run.id);
    intent.status = run.stopReason === "aborted" ? "cancelled" : run.stopReason === "error" ? "failed" : "completed";
    intent.error = run.errorMessage;
    await this.facts.update(scope, intent);
    if (intent.cancelled) return;
    const preparing=await this.facts.preparing(scope,run.sessionId);
    if(preparing) return this.facts.intent(scope,preparing);
    const rows = await this.facts.pending(scope, run.sessionId);
    if (!rows.length) return;
    const next=await this.facts.reserve(scope, run.sessionId, randomUUID(), rows[0].id, run.channel, { language: intent.language,context: intent.context,executionUserId:run.executionUserId });
    this.retain(next);return next;
  }
  async stopped(scope: Scope, run: RuntimeRun, next?: AgentRunIntent) {
    if (!run.channel) return;
    const intent = await this.facts.intent(scope, run.id);
    try {
      await this.callback(intent, "settle");
      await this.notify(scope, run.id);
    } catch (error) {
      intent.error = safeMessage(error); intent.status = "failed";
      await this.facts.update(scope, intent);
      await this.announce(intent);
      await this.notify(scope,run.id);
      throw error;
    } finally { if (next) this.launch(next); }
  }
  private async notify(scope: Scope, runId: string,preparedFailure=false) {
    const intent = await this.facts.intent(scope, runId);
    await this.announce(intent);
    const parent = intent.channel.requestedBy;
    const delivery = preparedFailure || ((intent.status === "failed" || intent.status === "cancelled") && intent.cancelMode!=="model" && !await this.facts.hasRun(scope,runId))
      ? { status: intent.status, summary: intent.error ?? intent.status, settled:true }
      : agentDeliverySchema.parse(await this.callback(intent, "read"));
    if (delivery.status === "running" || delivery.status === "starting") return;
    if (parent && !(intent.cancelled && intent.cancelMode!=="model")) {
      await this.deliver(parent.session, intent.channel.actor, {
        role: "notification", kind: "agent-result", source: { session: intent.session, runId },
        outcome: delivery.status, content: delivery.summary, timestamp: Date.now(),
      }, { resultRecipientRunId: parent.runId });
    }
    if (delivery.settled) this.release(intent);
  }
  async changed(scope:Scope,runId:string,kind:"delivery"|"quality"|"progress") {
    const intent=await this.facts.intent(scope,runId);
    if(kind==="progress" || intent.status==="starting") { await this.announce(intent);return; }
    await this.notify(scope,runId);
  }
  followUp(scope: Scope, run: RuntimeRun) { return this.consumeInputs(scope,run,"followup"); }
  steering(scope: Scope, run: RuntimeRun) { return this.consumeInputs(scope,run,"steer"); }
  private async consumeInputs(scope: Scope, run: RuntimeRun, mode: "followup" | "steer"): Promise<Message[]> {
    const pending = await this.runtime.locked(scope, run.sessionId, async () => {
      if ((await this.facts.intent(scope,run.id)).cancelled) { this.runtime.seal(scope,run.id); return []; }
      const rows = await this.facts.pending(scope,run.sessionId,mode === "steer" ? "steer" : undefined);
      if (!rows.length && mode === "followup") this.runtime.seal(scope,run.id);
      return rows;
    });
    if (!pending.length) return [];
    let context: string | undefined;
    for (const row of pending) {
      const channel = run.channel!;
      const prepared = agentSteerPreparationSchema.parse(await this.post(this.provider(channel.agent.providerId), "/prepare", { mode: "steer", executionActor:run.executionUserId ? {userId:run.executionUserId,domainId:scope.domainId} : null, language: run.language, agent: channel.agent, actor: channel.actor, sessionId: run.sessionId, runId: run.id, inputId: row.id, input: row.message, authority: channel.authority, requestedBy: channel.requestedBy, root: channel.root, userRecipient: channel.userRecipient ?? null }, scope.domainId, this.credential(channel)));
      if (prepared.context !== undefined) context = prepared.context;
    }
    await this.runtime.locked(scope,run.sessionId,async () => {
      await this.facts.consume(scope,run.sessionId,run.id,pending.map(row => row.id));
      if (context !== undefined) await this.runtime.updateHostContext(scope,run.id,context);
    });
    return pending.map(row => { const message = row.message as unknown as Message; this.inputIds.set(message, row.id); return message; });
  }
  /** The rebuilt model request has already consumed these queued inputs at a safe boundary. */
  modelMessagesForRun(scope: Scope, run: RuntimeRun, openingMessageId: string, rows: MessageRow[]): Promise<Message[]> {
    const direct = run.channel !== undefined && isDirectUserRun(run.channel, run.sessionId);
    return Promise.all(rows.map(row => this.modelMessage(scope.domainId, row.message,
      direct && row.runId === run.id && row.id !== openingMessageId)));
  }
  /** Shape model context only; receipt records and host decision inputs remain unchanged. */
  async modelMessage(domainId: string, message: RuntimeMessage, midRound = false): Promise<Message> {
    if (message.role !== "notification") return message as Message;
    let content = message.content;
    if (message.kind === "agent-answer" && message.replyTo) {
      const question = await this.facts.question(domainId,message.replyTo);
      content = `Question:\n${question.content}\n${question.defaultAssumption ? `Default assumption:\n${question.defaultAssumption}\n` : ""}Answer:\n${message.content}`;
    }
    const fact = midRound && message.kind === "agent-result" ? `\n${MID_ROUND_RESULT_NOTIFICATION_FACT}` : "";
    return { role:"user", timestamp:message.timestamp,
      content:`[Agent notification: ${JSON.stringify({kind:message.kind,source:message.source,replyTo:message.replyTo,selectedOption:message.selectedOption,answerId:message.answerId,outcome:message.outcome})}]\n${content}${message.defaultAssumption ? `\nDefault assumption: ${message.defaultAssumption}` : ""}${fact}` };
  }
  tool(scope: Scope, run: RuntimeRun): AgentTool {
    return {
      name: "agent", label: "Agent", description: "Communicate with authorized agents. Each op accepts only its own fields, and the server rejects any other. list: query. start: agent, message, title, context; creates an independent child session and returns immediately, and context is passed only as the target's contextSchema declares. send: session, message, steer, needsInput, replyTo, defaultAssumption, options; agent belongs to start only and must not be sent here. send addresses your creator or a child; any addressed input wakes an idle session or is consumed at a safe boundary. To add an ordinary message to a running recipient, set steer:true. replyTo is the id of a question the other party asked you, never a task id; it steers the answer into a running asker. Questions use needsInput with a default assumption and do not stop your work; options are allowed only with needsInput and mark exactly one isDefault, and session:\"parent\" in a conversation nobody delegated asks your user. read: taskId, files, view, cursor, limit; inspects an execution. cancel: taskId; cancels the execution and its delegated descendants.",
      parameters: Type.Object({ op: Type.String(), agent: Type.Optional(Type.Object({ providerId: Type.String(), agentId: Type.String() })), session: Type.Optional(Type.Union([Type.Object({ providerId: Type.String(), sessionId: Type.String() }),Type.Literal("parent")])), message: Type.Optional(Type.String()), taskId: Type.Optional(Type.String()), query: Type.Optional(Type.String()), title: Type.Optional(Type.String()), context: Type.Optional(Type.Record(Type.String(), Type.Unknown())), view: Type.Optional(Type.String()), cursor: Type.Optional(Type.Number()), limit: Type.Optional(Type.Number()), steer: Type.Optional(Type.Boolean()), needsInput: Type.Optional(Type.Boolean()), files: Type.Optional(Type.Boolean()), replyTo: Type.Optional(Type.String()), defaultAssumption: Type.Optional(Type.String()), options: Type.Optional(Type.Array(Type.Object({label:Type.String(),description:Type.Optional(Type.String()),isDefault:Type.Optional(Type.Boolean())}))) }),
      execute: async (_id, raw) => { const value = await this.execute(scope, run, raw); return { content: [{ type: "text", text: JSON.stringify(value) }], details: {} }; },
    };
  }
  async execute(scope: Scope, run: RuntimeRun | ExternalAgentCaller, raw: unknown): Promise<unknown> {
    const command = agentChannelCommandSchema.parse(raw);
    const external="kind" in run?run:null;
    const current=external?null:run as RuntimeRun;
    const channel=external?{actor:external.actor,authority:external.authority,root:null,agent:null}:current!.channel;
    if (!channel) throw new RuntimeError(403, "ACTOR_REQUIRED", "The host did not supply an agent caller");
    if (channel.authority.executionKind === "build-test") throw new RuntimeError(422,"BUILD_TEST_UNSUPPORTED","The agent channel is not available in a build-test execution");
    const source:AgentExecutionRef|undefined=current?{session:{providerId:channel.agent!.providerId,sessionId:current.sessionId},runId:current.id}:undefined;
    if (command.op === "list") {
      const directories = await Promise.all((this.runtime.options.agentProviders ?? []).map(async provider => {
        const result = agentDirectorySchema.parse(await this.post(provider,"/list",{ providerId: provider.id,actor: channel.actor,executionActor:current?.executionUserId ? {userId:current.executionUserId,domainId:scope.domainId} : null,language:run.language },scope.domainId, external?.credential ?? this.credential(current!.channel!)));
        if (result.agents.some(entry => entry.ref.providerId !== provider.id)) throw new RuntimeError(502,"INVALID_PROVIDER_DIRECTORY","A provider must list only its own agents");
        return result.agents;
      }));
      return { agents: directories.flat().filter(entry => !command.query || `${entry.name} ${entry.description}`.toLowerCase().includes(command.query.toLowerCase())) };
    }
    if (command.op === "start") {
      const target = { providerId: command.agent.providerId, sessionId: randomUUID() }, targetScope = this.scope(target, scope.domainId);
      const runId=randomUUID();
      const intent = await this.runtime.locked(targetScope, target.sessionId, () => this.facts.reserve(targetScope, target.sessionId,runId,randomUUID(),
        { agent: command.agent, actor: channel.actor, authority: channel.authority, requestedBy: source ?? null, root: channel.root ?? {session:target,runId}, userRecipient: current?.channel?.userRecipient ?? null },
        { language: run.language,context: command.context, title: command.title, create: { binding: { agent: command.agent, actor: channel.actor, parent: source ?? null, context: command.context },
          input: { role: "notification", kind: "agent-message", source: source ?? {kind:"external"}, content: command.message, timestamp: Date.now() } } }));
      if (external) this.remember(intent.channel,external.credential);
      this.retain(intent);
      await this.announce(intent); this.launch(intent);
      return { taskId: intent.id, sessionRef: target, status: intent.status };
    }
    if (command.op === "send") {
      const own = source?await this.facts.binding(scope,source.session.sessionId):null;
      const target = command.session === "parent" ? own?.parent?.session : command.session;
      const input: AgentNotification = { role: "notification",kind: command.needsInput ? "agent-question" : command.replyTo ? "agent-answer" : "agent-message",source:source ?? {kind:"external"},content: command.message,timestamp: Date.now(),replyTo: command.replyTo,defaultAssumption: command.defaultAssumption, options: command.options };
      if (!target) {
        if (!source || !command.needsInput) throw new RuntimeError(400,"NO_CREATOR","This conversation has no creating session");
        const record = await this.runtime.locked(scope,source.session.sessionId,async () => {
          const row = await this.facts.receive(scope,source.session.sessionId,input,{ outputRunId: source.runId });
          await this.runtime.inputReceived(scope,source.runId,row);
          return row;
        });
        await this.runtime.questionsChanged(scope,source.session.sessionId);
        this.emitChange(scope,source.session.sessionId);
        return { questionId: record.id,taskId: source.runId,recipient: "caller" };
      }
      const binding = await this.facts.binding(this.scope(target,scope.domainId),target.sessionId);
      const child = !!source && binding.parent?.session.providerId === source.session.providerId && binding.parent.session.sessionId === source.session.sessionId;
      const parent = own?.parent?.session.providerId === target.providerId && own.parent.session.sessionId === target.sessionId;
      if (source && !child && !parent) throw new RuntimeError(403,"FORBIDDEN","Messages may only address your creator or a session you created");
      if (command.replyTo) {
        const question = await this.facts.question(scope.domainId,command.replyTo);
        if (!("session" in question.source) || question.source.session.providerId !== target.providerId || question.source.session.sessionId !== target.sessionId) throw new RuntimeError(400,"INVALID_REPLY","The question was sent by another conversation");
      }
      return this.deliver(target,channel.actor,input,{requestedBy:child?source:undefined,steer:command.steer===true || !!command.replyTo,...(external?{external}:{})});
    }
    const entry = await this.facts.task(scope.domainId,command.taskId);
    if (!entry || (source?!await this.accessible(entry.intent,source.session,scope.domainId):channel.actor.id!==entry.intent.channel.actor.id)) throw new RuntimeError(403, "FORBIDDEN", "Execution is outside your delegation tree");
    if (command.op === "cancel") { await this.cancel(entry.scope, entry.intent); return { taskId: command.taskId, accepted: true }; }
    const intent = entry.intent;
    const questions=await this.facts.questions(entry.scope,{session:intent.session,runId:intent.id});
    if (intent.status === "starting" || ((intent.status === "failed" || intent.status === "cancelled") && intent.cancelMode!=="model" && !await this.facts.hasRun(entry.scope,intent.id))) return { taskId:intent.id,sessionRef:intent.session,status:intent.status,error:intent.error,questions,files:[] };
    const result = agentDeliverySchema.parse(await this.callback(intent,"read"));
    const downloaded=[];
    if(command.files && source) for(const file of result.files) {
      const response=await this.file(intent,file.id);
      const path=await this.runtime.importAgentFile(scope,source.runId,intent.id,file,Buffer.from(await response.arrayBuffer()));
      downloaded.push({id:file.id,path,taskId:intent.id});
    }
    if (command.view !== "messages") return { taskId:intent.id,sessionRef:intent.session,...result,questions,...(command.files && source?{downloaded}:{}) };
    const messages = (await this.runtime.store.messages(entry.scope, intent.session.sessionId)).filter(row => row.runId === intent.id && row.message.role !== "system" && row.messageSeq > (command.cursor ?? 0)).slice(0, command.limit ?? 50);
    return { taskId:intent.id,sessionRef:intent.session,...result,questions,messages,cursor: messages.at(-1)?.messageSeq ?? command.cursor ?? 0,...(command.files && source?{downloaded}:{}) };
  }
  private async accessible(intent: AgentRunIntent, source: AgentSessionRef, domainId: string) {
    const sameSession = (ref: AgentSessionRef) => ref.providerId === source.providerId && ref.sessionId === source.sessionId;
    if (sameSession(intent.session)) return true;
    let current = intent;
    while (current.channel.requestedBy) {
      const parent = current.channel.requestedBy;
      if (sameSession(parent.session)) return true;
      current = await this.facts.intent(this.scope(parent.session,domainId),parent.runId);
    }
    return false;
  }
  async stopModel(scope:Scope,runId:string) {
    const intent=await this.facts.intent(scope,runId);
    const children=await this.runtime.locked(scope,intent.session.sessionId,async()=>{
      const current=await this.facts.intent(scope,runId);current.cancelled=true;current.cancelMode="model";
      this.takePresentationBinding(current);
      if(current.status==="starting") current.status="cancelled";
      await this.facts.closePending(scope,current.session.sessionId,current.id);
      await this.facts.update(scope,current);
      return this.facts.children(scope.domainId,{session:current.session,runId});
    });
    const stopped=await Promise.allSettled(children.map(child=>this.cancel(child.scope,child.intent)));
    try { if(await this.facts.hasRun(scope,runId)) await this.runtime.cancel(scope,runId,true); }
    finally { await this.announce(await this.facts.intent(scope,runId)); }
    const failures=stopped.flatMap(result=>result.status==="rejected"?[result.reason]:[]);
    if(failures.length) throw new AggregateError(failures,"Delegated execution cancellation failed");
  }
  async cancel(scope: Scope, intent: AgentRunIntent) {
    const descendants: Array<{ scope: Scope; intent: AgentRunIntent; cancelHost:boolean }> = [];
    const seal = async (scope: Scope, candidate: AgentRunIntent) => {
      const children = await this.runtime.locked(scope,candidate.session.sessionId,async () => {
        const current = await this.facts.intent(scope,candidate.id);
        this.takePresentationBinding(current);
        const cancelHost=current.cancelMode==="model" || current.status!=="starting" && current.status!=="cancelled";
        current.cancelled = true;current.cancelMode=undefined;
        await this.facts.closePending(scope,current.session.sessionId,current.id);
        if (current.status === "starting") current.status = "cancelled";
        await this.facts.update(scope,current);
        descendants.push({ scope,intent: current,cancelHost });
        return this.facts.children(scope.domainId,{ session: current.session,runId: current.id });
      });
      for (const child of children) await seal(child.scope,child.intent);
    };
    await seal(scope,intent);
    const failures: unknown[] = [];
    for (const entry of descendants.reverse()) {
      try { if (entry.cancelHost) await this.callback(entry.intent, "cancel"); }
      catch (error) { failures.push(error); }
      try { if (entry.intent.status === "running") await this.runtime.cancel(entry.scope, entry.intent.id, true); }
      catch (error) { failures.push(error); }
    }
    for (const entry of descendants) await this.announce(entry.intent);
    if (failures.length) throw new AggregateError(failures,"One or more agent hosts rejected cancellation settlement");
  }
  async process(scope: Scope, sessionId: string, taskId: string) {
    const task = (await this.tasks(scope, sessionId)).tasks.find(task => task.id === taskId);
    if (!task || task.kind!=="agent" || task.process.mode !== "inline") throw new RuntimeError(404, "NOT_FOUND", "Task process not found");
    return { scope: this.scope(task.sessionRef, scope.domainId), runId: task.runId };
  }
  async tasks(scope: Scope, sessionId: string) {
    await this.runtime.store.session(scope, sessionId);
    const sessions = (this.runtime.options.agentProviders ?? []).filter(provider => provider.hostId === scope.hostId).map(provider => ({ providerId: provider.id,sessionId }));
    const roots = await this.facts.descendants(scope.domainId,sessions);
    const own = (source: AgentExecutionRef) => sessions.some(session => session.providerId === source.session.providerId && session.sessionId === source.session.sessionId);
    const tasks: AgentTask[] = [],qualityResults: QualityResult[]=[];
    for (const { intent,rootRunId } of roots) {
      const requestedBy = intent.channel.requestedBy!;
      const delivery = intent.status === "starting" || ((intent.status === "failed" || intent.status === "cancelled") && intent.cancelMode!=="model" && !await this.facts.hasRun(this.scope(intent.session,scope.domainId),intent.id)) ? null : agentDeliverySchema.parse(await this.callback(intent, "read"));
      const input = (await this.runtime.store.messages(this.scope(intent.session,scope.domainId),intent.session.sessionId)).find(row => row.id === intent.inputId)!.message;
      tasks.push({ id: intent.id, kind: "agent", root: { sessionId, runId: rootRunId }, requestedBy, parentTaskId: own(requestedBy) ? null : requestedBy.runId,
        title: intent.title ?? (typeof input.content === "string" ? input.content.split("\n")[0] : intent.channel.agent.agentId), status: delivery?.status ?? intent.status, error: intent.error ? { code: "AGENT_EXECUTION_FAILED", message: intent.error } : null,
        createdAt: intent.createdAt, agentRef: intent.channel.agent, sessionRef: intent.session, runId: intent.id, process: delivery?.process ?? { mode: "none" }, results: delivery?.results ?? [],...(delivery?.retrieval?{retrieval:delivery.retrieval}:{}) });
      for(const quality of delivery?.quality ?? []) {
        const {result,...job}=quality;
        tasks.push({...job,parentTaskId:intent.id,root:{sessionId,runId:rootRunId}});
        if(result) qualityResults.push(result);
      }
    }
    return { sessionId, tasks, qualityResults, preparationFailures: await this.facts.preparationFailures(scope,sessionId), pendingQuestions: await this.facts.pendingQuestions(scope,sessionId), notifications: (await this.runtime.store.messages(scope, sessionId)).filter(row => row.message.role === "notification") };
  }
}
