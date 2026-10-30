<script setup lang="ts">
import type { LoopSubagentTrace } from "@ontomato/contracts/analysis-task";
import type { EgressMessage } from "@ontomato/contracts/agent-egress";

import { computed, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useAnalysisStore } from "../stores/analysis";
import {
  CheckCircle2,
  Zap,
  Clock,
  CircleSlash,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { analysisTaskApi } from "../api";
import type { Message } from "../../../types/chat";
import type {
  AnalysisActivity,
  DeepAnalysisTaskPayload,
} from "@ontomato/contracts/analysis-presentation";
import { renderMarkdown } from "../../../utils/markdown";
import { renderAgentMarkdown } from "../../../utils/agent-markdown";
import {
  loopActivityDetail,
  loopActivityLabel,
  loopQuestionStatusText,
} from "../utils/loop-activity";
import DeepAnalysisResult from "./DeepAnalysisResult.vue";
import AgentMessageTrace from "./AgentMessageTrace.vue";
import AnalysisMessageBody from "./AnalysisMessageBody.vue";
import QuestionExecution, { type QuestionExecutionScope } from "./QuestionExecution.vue";
import TurnDiagnoseButton from "../../diagnosis/components/TurnDiagnoseButton.vue";
import { buildDimensionTree, dimensionStageStates } from "../utils/dimension-view";
import { workbenchContent } from "../../../content";

const runSwitcherCopy = workbenchContent().text.runSwitcher;

const { t } = useI18n();

const store = useAnalysisStore();
const { currentTask: task, taskRuns, taskRunIndex, hasReportArtifact } = storeToRefs(store);
const {
  displayMessages: messages,
  displayStreamingSnapshot: streamingSnapshot,
  displayIsLoading: isLoading,
  displayHistoryLoading: historyLoading,
} = storeToRefs(store);
const runCount = computed(() => taskRuns.value.length);
const runIndex = computed(() => taskRunIndex.value);

function selectRun(index: number) {
  store.selectRun(index);
}

const expandedLoopActivities = ref<Record<string, boolean>>({});
/** Per-turn execution process expansion; collapsed unless the user opened it. */
const expandedLoopProcesses = ref<Record<string, boolean>>({});

interface SubagentTraceState {
  expanded: boolean;
  loading: boolean;
  trace?: LoopSubagentTrace;
  error?: boolean;
}

const subagentTraceStates = ref<Record<string, SubagentTraceState>>({});

watch(
  () => task.value?.id,
  () => {
    expandedLoopActivities.value = {};
    expandedLoopProcesses.value = {};
    subagentTraceStates.value = {};
  }
);

/** Only report tasks switch by run history; regular continuous conversations always show all turns. Judged by the task's own delivery mode. */
const isReportTask = computed(() => task.value?.reportDeliverableEnabled !== false);
const isLoopExecuting = computed(() => {
  if (!store.isSelectedLatestRun) return false;
  const payload = streamingSnapshot.value?.deepAnalysis;
  const loop = payload?.executionMode === "loop" || task.value?.executionMode === "loop";
  if (payload) return loop && payload.runState.status === "running";
  return loop && (isLoading.value || task.value?.status === "running");
});

/**
 * Stable identity of a rendered turn. Message ids are rebuilt when live turns settle into history
 * and historical runs reuse the same message and activity ids, so the key is scoped by the task,
 * the run view being inspected, and the turn's own acceptance sequence (or runId / position).
 */
function buildTurnKey(
  turn: { requestSeq?: number; runId?: string },
  index: number
): string {
  const view =
    isReportTask.value && !store.isSelectedLatestRun
      ? `run:${store.selectedRun?.id}`
      : "current";
  const identity =
    turn.requestSeq !== undefined
      ? `seq:${turn.requestSeq}`
      : turn.runId
        ? `run:${turn.runId}`
        : `pos:${index}`;
  return `${task.value?.id || "task"}|${view}|${identity}`;
}

/** Rendered turn by turn: each turn's user message, execution artifacts, and reply are grouped, and later turns don't overwrite earlier ones. */
interface TurnGroup {
  key: string;
  user: Message | null;
  assistant: Message | null;
  payload: DeepAnalysisTaskPayload | null;
  /** Public messages and tool results already egress-filtered for this turn; only from this turn's snapshot. */
  trace: EgressMessage[];
  /** This turn is streaming: the payload comes from the streaming snapshot, or the standard follow-up body is still growing. */
  streaming: boolean;
  streamingText: string;
  /** Acceptance sequence of the turn this group shows, when its snapshot carries one. */
  requestSeq?: number;
  /** Run identity carried by the snapshot when present. */
  runId?: string;
}

const turnGroups = computed<TurnGroup[]>(() => {
  const groups: TurnGroup[] = [];
  for (const message of messages.value) {
    if (message.role === "user") {
      groups.push({
        key: "",
        user: message,
        assistant: null,
        payload: null,
        trace: [],
        streaming: false,
        streamingText: "",
      });
      continue;
    }
    let group = groups[groups.length - 1];
    if (!group || group.assistant) {
      group = {
        key: "",
        user: null,
        assistant: null,
        payload: null,
        trace: [],
        streaming: false,
        streamingText: "",
      };
      groups.push(group);
    }
    group.assistant = message;
    group.requestSeq = message.snapshot?.requestSeq;
    group.runId = message.snapshot?.runId;
    if (message.snapshot?.mode === "deep-analysis" && message.snapshot.deepAnalysis) {
      group.payload = message.snapshot.deepAnalysis;
    }
    if (message.snapshot?.trace) group.trace = message.snapshot.trace;
  }

  const streaming = streamingSnapshot.value;
  if (streaming) {
    let group = groups[groups.length - 1];
    // Only attach to the current turn that has no reply yet; when the previous turn is complete, don't overwrite its artifacts.
    if (!group || group.assistant) {
      group = {
        key: "",
        user: null,
        assistant: null,
        payload: null,
        trace: [],
        streaming: false,
        streamingText: "",
      };
      groups.push(group);
    }
    group.streaming = true;
    group.requestSeq = streaming.requestSeq;
    group.runId = streaming.runId;
    if (streaming.trace) group.trace = streaming.trace;
    if (streaming.mode === "deep-analysis" && streaming.deepAnalysis) {
      group.payload = streaming.deepAnalysis;
    } else {
      group.streamingText = streaming.primaryText || "";
    }
  }

  return groups.map((group, index) => ({
    ...group,
    key: buildTurnKey(group, index),
  }));
});

/** First occurrence position of a follow-up record: the first standard follow-up turn after a turn with execution artifacts. */
const followUpDividerIndex = computed(() => {
  let seenExecution = false;
  for (let index = 0; index < turnGroups.value.length; index++) {
    const group = turnGroups.value[index];
    if (group.payload) {
      seenExecution = true;
      continue;
    }
    if (seenExecution) return index;
  }
  return -1;
});

/**
 * Where a group's deferred question facts are read: a report addresses the run being viewed (the
 * current one or a selected historical run); a regular session addresses the group's own turn.
 */
function executionScope(group: TurnGroup): QuestionExecutionScope {
  const taskId = task.value!.id;
  if (task.value!.reportDeliverableEnabled === false)
    return { taskId, requestSeq: group.requestSeq };
  return { taskId, runId: store.isSelectedLatestRun ? undefined : store.selectedRun?.id };
}

/** Loop-mode progress is expressed by a monotone activity stream, not the dimension-orchestration stage cards and dimension framework. */
function isLoopMode(payload: DeepAnalysisTaskPayload | null): boolean {
  return payload?.executionMode === "loop";
}
function loopActivities(payload: DeepAnalysisTaskPayload | null): AnalysisActivity[] {
  return payload?.activities || [];
}
function loopProgress(payload: DeepAnalysisTaskPayload | null) {
  return payload?.runState.progress;
}
function activityStatusText(status: AnalysisActivity["status"]): string {
  if (status === "running") return t("common.inProgress");
  if (status === "failed") return t("common.failed");
  if (status === "cancelled") return t("common.stopped");
  return t("analysis.completed");
}
function thinkingTree(payload: DeepAnalysisTaskPayload | null) {
  return buildDimensionTree(payload?.activities || []);
}

function loopActivityKey(groupKey: string, activityId: string): string {
  return `${groupKey}|${activityId}`;
}

/** A step opens when it has business details or its own tool call records. */
function isLoopActivityExpandable(activity: AnalysisActivity, tools?: EgressMessage[]): boolean {
  return (
    activity.kind === "dispatch" ||
    (activity.kind === "evidence" && !!activity.questions?.length) ||
    !!tools?.length
  );
}

function isLoopActivityExpanded(groupKey: string, activity: AnalysisActivity): boolean {
  return !!expandedLoopActivities.value[loopActivityKey(groupKey, activity.activityId)];
}

function toggleLoopActivity(
  groupKey: string,
  activity: AnalysisActivity,
  tools?: EgressMessage[]
) {
  if (!isLoopActivityExpandable(activity, tools)) return;
  const key = loopActivityKey(groupKey, activity.activityId);
  expandedLoopActivities.value = {
    ...expandedLoopActivities.value,
    [key]: !expandedLoopActivities.value[key],
  };
}

function subagentTraceState(
  groupKey: string,
  activityId: string
): SubagentTraceState | undefined {
  return subagentTraceStates.value[loopActivityKey(groupKey, activityId)];
}

async function toggleSubagentTrace(groupKey: string, activityId: string) {
  const key = loopActivityKey(groupKey, activityId);
  const current = subagentTraceStates.value[key];
  if (current?.expanded) {
    subagentTraceStates.value = {
      ...subagentTraceStates.value,
      [key]: { ...current, expanded: false },
    };
    return;
  }
  if (current?.trace) {
    subagentTraceStates.value = {
      ...subagentTraceStates.value,
      [key]: { ...current, expanded: true },
    };
    return;
  }

  const taskId = task.value?.id;
  if (!taskId) return;
  subagentTraceStates.value = {
    ...subagentTraceStates.value,
    [key]: { expanded: true, loading: true },
  };
  try {
    const trace = await analysisTaskApi.getLoopSubagentTrace(taskId, activityId);
    if (task.value?.id !== taskId) return;
    subagentTraceStates.value = {
      ...subagentTraceStates.value,
      [key]: { expanded: true, loading: false, trace },
    };
  } catch {
    if (task.value?.id !== taskId) return;
    subagentTraceStates.value = {
      ...subagentTraceStates.value,
      [key]: { expanded: true, loading: false, error: true },
    };
  }
}

function toggleLoopProcess(key: string) {
  expandedLoopProcesses.value = {
    ...expandedLoopProcesses.value,
    [key]: !expandedLoopProcesses.value[key],
  };
}

interface StepState {
  name: string;
  status: "done" | "active" | "pending" | "stopped";
  detail: string;
}

const stages = [
  t("analysis.frameworkGeneration"),
  t("analysis.metricCollection"),
  t("analysis.dataAnalysis"),
  t("analysis.reportGeneration"),
];

function analysisSteps(payload: DeepAnalysisTaskPayload | null): StepState[] {
  if (!payload || isLoopMode(payload)) return [];
  return dimensionStageStates(payload).map((status, i) => ({
    name: stages[i],
    status,
    detail:
      status === "active"
        ? payload.runState.progress.label
        : status === "stopped"
          ? t("analysis.analysisStopped")
          : "",
  }));
}
function hasCompletedAnalysis(payload: DeepAnalysisTaskPayload | null): boolean {
  return payload?.runState.status === "completed";
}
function isStoppedAnalysis(payload: DeepAnalysisTaskPayload | null): boolean {
  return payload?.runState.status === "cancelled";
}
function isFailedAnalysis(payload: DeepAnalysisTaskPayload | null): boolean {
  return payload?.runState.status === "failed";
}
function showStepCards(payload: DeepAnalysisTaskPayload | null): boolean {
  return !isLoopMode(payload) && analysisSteps(payload).length > 0;
}
/** Placeholder only while the saved conversation is being read; an empty idle view stays static. */
const showHistoryLoading = computed(
  () => historyLoading.value && messages.value.length === 0 && !streamingSnapshot.value
);

/**
 * This turn's reply body only takes this turn's own artifacts or reply; it doesn't use the task's
 * current fields to backfill the last turn, otherwise the previous turn's answer would leak into a
 * new turn that hasn't produced an answer yet. The execution turn's body is delivered by the report view.
 */
function groupAnswer(group: TurnGroup): string {
  // The deep analysis body of a report task is delivered only in the report view; even if that run
  // is cancelled and produces no report artifact, partial body must not be rolled back from the
  // snapshot into the chat bubble.
  if (group.payload && isReportTask.value) return "";
  return group.payload?.finalAnswer || group.assistant?.content || "";
}

/**
 * Narrow display deduplication for finished regular-session turns: only when the turn has ended,
 * the very last activity is a narrative, and its text is strictly identical to the non-empty
 * payload.finalAnswer, omit that trailing narrative from the turn body so the immediately
 * following reply bubble carries it once.
 */
function visibleLoopActivities(group: TurnGroup): AnalysisActivity[] {
  const activities = loopActivities(group.payload);
  const finalAnswer = group.payload?.finalAnswer;
  if (
    !isReportTask.value &&
    !group.streaming &&
    group.payload?.runState.status !== "running" &&
    typeof finalAnswer === "string" &&
    finalAnswer !== "" &&
    activities.length > 0
  ) {
    const last = activities[activities.length - 1];
    if (last.kind === "narrative" && last.narrative === finalAnswer) {
      return activities.slice(0, -1);
    }
  }
  return activities;
}

/** One stretch of process activities between two visible narrations, folded as one block. */
interface LoopProcessSegment {
  kind: "process";
  /** Stable across streaming and history: the turn key plus the segment's first activity. */
  key: string;
  steps: AnalysisActivity[];
  /** Steps that failed or carry a failed query or skill, surfaced on the collapsed header. */
  failedSteps: number;
  /** This turn's tool records with no producing activity; held only by the turn's first stretch. */
  otherTools: EgressMessage[];
}

/** A turn's loop activities in acceptance order: public narration shown directly, process stretches folded. */
type LoopEntry = { kind: "narrative"; activity: AnalysisActivity } | LoopProcessSegment;

interface LoopTurnView {
  entries: LoopEntry[];
  /** Tool calls and results of each step, by the step's activityId. */
  stepTools: Map<string, EgressMessage[]>;
}

function hasFailure(activity: AnalysisActivity): boolean {
  return (
    activity.status === "failed" ||
    !!activity.questions?.some((question) => question.status === "failed") ||
    !!activity.skills?.some((skill) => skill.status === "failed")
  );
}

/**
 * Routes this turn's public tool calls and results by their real call identity: a record whose
 * call produced a step goes to that step, anything else (calls without a business activity,
 * records saved before activities carried the identity) stays unattributed. The user message and
 * assistant text are dropped because they are already the turn's question and body; an assistant
 * message with several calls is split per call so each record lands exactly once.
 */
function routeToolTrace(group: TurnGroup) {
  const owners = new Map<string, string>();
  for (const activity of loopActivities(group.payload)) {
    if (activity.kind !== "narrative" && activity.toolCallId && !owners.has(activity.toolCallId)) {
      owners.set(activity.toolCallId, activity.activityId);
    }
  }
  const stepTools = new Map<string, EgressMessage[]>();
  const otherTools: EgressMessage[] = [];
  const route = (toolCallId: string, message: EgressMessage) => {
    const owner = owners.get(toolCallId);
    if (!owner) otherTools.push(message);
    else stepTools.set(owner, [...(stepTools.get(owner) || []), message]);
  };
  for (const message of group.trace) {
    if (message.role === "toolResult") route(message.toolCallId, message);
    if (message.role !== "assistant") continue;
    for (const part of message.content) {
      if (part.type === "toolCall") route(part.id, { ...message, content: [part] });
    }
  }
  return { stepTools, otherTools };
}

function loopEntries(group: TurnGroup, otherTools: EgressMessage[]): LoopEntry[] {
  const entries: LoopEntry[] = [];
  for (const activity of visibleLoopActivities(group)) {
    if (activity.kind === "narrative") {
      // Only narration with visible text separates process stretches.
      if (activity.narrative?.trim()) entries.push({ kind: "narrative", activity });
      continue;
    }
    const last = entries[entries.length - 1];
    if (last?.kind === "process") {
      last.steps.push(activity);
      continue;
    }
    entries.push({
      kind: "process",
      key: `${group.key}|${activity.activityId}`,
      steps: [activity],
      failedSteps: 0,
      otherTools: [],
    });
  }
  for (const entry of entries) {
    if (entry.kind === "process") entry.failedSteps = entry.steps.filter(hasFailure).length;
  }
  if (otherTools.length) {
    const first = entries.find((entry) => entry.kind === "process");
    if (first) first.otherTools = otherTools;
    else {
      entries.unshift({
        kind: "process",
        key: `${group.key}|other-tools`,
        steps: [],
        failedSteps: 0,
        otherTools,
      });
    }
  }
  return entries;
}

const loopViews = computed(() =>
  turnGroups.value.map((group): LoopTurnView | null => {
    if (!isLoopMode(group.payload)) return null;
    const { stepTools, otherTools } = routeToolTrace(group);
    return { entries: loopEntries(group, otherTools), stepTools };
  })
);

/** Folded header state of one process segment. */
function segmentStatusClass(segment: LoopProcessSegment): "active" | "done" | "failed" | "stopped" {
  if (segment.steps.some((a) => a.status === "running")) return "active";
  if (segment.failedSteps) return "failed";
  if (segment.steps.some((a) => a.status === "cancelled")) return "stopped";
  return "done";
}

function segmentRunning(segment: LoopProcessSegment): boolean {
  return segmentStatusClass(segment) === "active";
}

function segmentDone(segment: LoopProcessSegment): number {
  return segment.steps.filter((a) => a.status !== "running").length;
}

function showFirstTurnAcknowledgment(group: TurnGroup, index: number): boolean {
  if (index !== 0 || !group.user) return false;
  // Dimension orchestration keeps its baseline acknowledgment; loop mode shows it only for report tasks.
  if (group.payload && !isLoopMode(group.payload)) return true;
  return isReportTask.value;
}

function showCompletedNotice(group: TurnGroup, index: number): boolean {
  if (index !== turnGroups.value.length - 1 || !hasCompletedAnalysis(group.payload)) return false;
  // Dimension orchestration keeps its exact baseline condition; loop mode prompts only for report runs with a report artifact.
  if (!isLoopMode(group.payload)) return true;
  return isReportTask.value && hasReportArtifact.value;
}

function showStoppedNotice(group: TurnGroup, index: number): boolean {
  if (!isStoppedAnalysis(group.payload)) return false;
  if (!isLoopMode(group.payload)) return index === turnGroups.value.length - 1;
  return true;
}

function showFailedNotice(group: TurnGroup): boolean {
  return isLoopMode(group.payload) && isFailedAnalysis(group.payload);
}
</script>

<template>
  <div class="analysis-chat-view">
    <div v-if="showHistoryLoading" class="chat-empty">
      <div class="ai-skeleton">
        <el-skeleton animated :rows="10" />
      </div>
    </div>

    <div v-else class="messages-scroll">
      <div class="messages-inner">
        <!-- Rendered turn by turn: each turn's user message, execution process, and reply stay in their own turn; later turns don't overwrite earlier ones -->
        <template v-for="(group, gi) in turnGroups" :key="group.key">
          <div v-if="gi === followUpDividerIndex" class="follow-up-section">
            <div class="follow-up-divider">
              <span>{{ t("analysis.followUpRecord") }}</span>
            </div>
          </div>

          <div v-if="group.user" class="chat-msg user">
            <div class="chat-bubble user">{{ group.user.content }}</div>
          </div>

          <div
            v-if="
              gi === 0 &&
              group.user &&
              isReportTask &&
              (runCount || 0) > 1 &&
              task?.status !== 'running'
            "
            class="run-switcher-row"
          >
            <div class="run-switcher" :aria-label="runSwitcherCopy.label">
              <button
                :disabled="runIndex === 0"
                :title="runSwitcherCopy.previous"
                @click="selectRun((runIndex || 0) - 1)"
              >
                ‹
              </button>
              <span class="run-index">{{ (runIndex || 0) + 1 }} / {{ runCount }}</span>
              <button
                :disabled="runIndex === (runCount || 0) - 1"
                :title="runSwitcherCopy.next"
                @click="selectRun((runIndex || 0) + 1)"
              >
                ›
              </button>
            </div>
          </div>

          <!-- The first turn of a report task shows the user's topic first, then confirms the analysis start; follow-up turns and regular sessions don't repeat it. -->
          <div
            v-if="showFirstTurnAcknowledgment(group, gi)"
            class="chat-msg system analysis-acknowledgment"
          >
            <div class="chat-bubble system">{{ t("analysis.analysisReceived") }}</div>
          </div>

          <!-- Loop execution mode: activities in acceptance order. Public narration is shown directly; each stretch of process activities between narrations is one collapsed block (L1 steps, on-demand L2 details, L3 worker trace). -->
          <template v-if="loopViews[gi]">
            <template
              v-for="entry in loopViews[gi]!.entries"
              :key="entry.kind === 'process' ? entry.key : entry.activity.activityId"
            >
              <div v-if="entry.kind === 'narrative'" class="chat-msg assistant">
                <div
                  class="chat-bubble assistant loop-content loop-bubble"
                  :class="{ streaming: entry.activity.status === 'running' }"
                >
                  <div class="loop-narrative">
                    <AnalysisMessageBody
                      :content="entry.activity.narrative || ''"
                      :charts="group.payload?.charts"
                      safe
                    />
                  </div>
                </div>
              </div>

              <div v-else class="loop-process">
                <button
                  type="button"
                  class="loop-process-toggle"
                  :aria-expanded="!!expandedLoopProcesses[entry.key]"
                  @click="toggleLoopProcess(entry.key)"
                >
                  <ChevronDown
                    v-if="expandedLoopProcesses[entry.key]"
                    class="loop-process-chevron"
                    :size="15"
                  />
                  <ChevronRight v-else class="loop-process-chevron" :size="15" />
                  <span class="step-icon" :class="segmentStatusClass(entry)">
                    <Zap v-if="segmentRunning(entry)" :size="12" />
                    <CheckCircle2 v-else-if="segmentStatusClass(entry) === 'done'" :size="12" />
                    <CircleSlash v-else :size="12" />
                  </span>
                  <span class="step-name" :class="segmentStatusClass(entry)">
                    {{ t("analysis.loopProcess") }}
                  </span>
                  <span v-if="entry.steps.length" class="loop-process-summary">
                    {{ t("analysis.loopActivityCount", { done: segmentDone(entry) }) }}
                    <template v-if="segmentRunning(entry) && loopProgress(group.payload)?.label">
                      ·
                      {{
                        t("analysis.loopCurrentActivity", {
                          name: loopProgress(group.payload)?.label || "",
                        })
                      }}
                    </template>
                  </span>
                  <span v-if="entry.failedSteps" class="loop-process-failures">
                    {{ t("analysis.loopProcessFailures", { n: entry.failedSteps }) }}
                  </span>
                </button>

                <div v-if="expandedLoopProcesses[entry.key]" class="loop-process-body">
                  <div v-if="entry.steps.length" class="loop-timeline">
                    <div
                      v-for="activity in entry.steps"
                      :key="activity.activityId"
                      class="loop-timeline-item"
                      :class="`status-${activity.status}`"
                    >
                      <div class="loop-rail" aria-hidden="true">
                        <div
                          class="tree-dim-icon"
                          :class="{
                            done: activity.status === 'completed',
                            running: activity.status === 'running',
                            failed: activity.status === 'failed',
                            stopped: activity.status === 'cancelled',
                          }"
                        >
                          <CheckCircle2 v-if="activity.status === 'completed'" :size="12" />
                          <Zap v-else-if="activity.status === 'running'" :size="12" />
                          <CircleSlash v-else :size="12" />
                        </div>
                      </div>

                      <div class="loop-item-body">
                        <button
                          type="button"
                          class="tree-dim-header loop-activity-header"
                          :disabled="!isLoopActivityExpandable(activity, loopViews[gi]!.stepTools.get(activity.activityId))"
                          :aria-expanded="
                            isLoopActivityExpandable(activity, loopViews[gi]!.stepTools.get(activity.activityId))
                              ? isLoopActivityExpanded(group.key, activity)
                              : undefined
                          "
                          @click="toggleLoopActivity(group.key, activity, loopViews[gi]!.stepTools.get(activity.activityId))"
                        >
                          <span class="tree-dim-name loop-step-title">
                            {{ loopActivityLabel(activity, t) }}
                          </span>
                          <span
                            v-if="activity.status !== 'completed'"
                            class="loop-step-state"
                            :class="activity.status"
                          >
                            {{ activityStatusText(activity.status) }}
                          </span>
                          <template v-if="isLoopActivityExpandable(activity, loopViews[gi]!.stepTools.get(activity.activityId))">
                            <ChevronDown
                              v-if="isLoopActivityExpanded(group.key, activity)"
                              class="loop-expand-icon"
                              :size="15"
                            />
                            <ChevronRight v-else class="loop-expand-icon" :size="15" />
                          </template>
                        </button>

                        <div
                          v-if="loopActivityDetail(activity, t)"
                          class="loop-step-detail"
                          :class="{
                            'is-tool-meta':
                              activity.kind === 'probe' || activity.kind === 'external_tool',
                            'is-error': activity.status === 'failed' || !!activity.error,
                          }"
                        >
                          {{ loopActivityDetail(activity, t) }}
                        </div>

                        <div
                          v-if="
                            activity.kind === 'evidence' &&
                            isLoopActivityExpanded(group.key, activity) &&
                            activity.questions?.length
                          "
                          class="loop-questions-box"
                        >
                          <div
                            v-for="question in activity.questions"
                            :key="question.questionId"
                            class="tree-question loop-question-row"
                            :class="{
                              done: question.status === 'completed',
                              running: question.status === 'running',
                              failed: question.status === 'failed',
                              stopped: question.status === 'cancelled',
                            }"
                          >
                            <div class="tree-q-status">
                              <CheckCircle2 v-if="question.status === 'completed'" :size="11" />
                              <Zap v-else-if="question.status === 'running'" :size="11" class="spin" />
                              <CircleSlash v-else :size="11" />
                            </div>
                            <span class="tree-q-text">{{ question.question }}</span>
                            <span
                              class="tree-q-status-text"
                              :class="{ error: question.status === 'failed' }"
                            >
                              {{ loopQuestionStatusText(question, t) }}
                            </span>
                            <QuestionExecution
                              v-if="question.execution"
                              class="loop-query-execution"
                              :question="question"
                              :scope="executionScope(group)"
                            />
                          </div>
                        </div>

                        <div
                          v-if="
                            activity.kind === 'dispatch' &&
                            isLoopActivityExpanded(group.key, activity)
                          "
                          class="loop-dispatch-detail"
                        >
                          <div class="loop-detail-field">
                            <span>{{ t("analysis.loopDispatchTopic") }}</span>
                            <p>{{ activity.topic || "-" }}</p>
                          </div>
                          <div v-if="activity.workerSummary" class="loop-detail-field">
                            <span>{{ t("analysis.loopDispatchSummary") }}</span>
                            <div
                              class="loop-worker-summary markdown-body markdown-content"
                              v-html="renderAgentMarkdown(activity.workerSummary)"
                            ></div>
                          </div>
                          <button
                            v-if="activity.status !== 'running' && task?.id"
                            type="button"
                            class="loop-trace-toggle"
                            :aria-expanded="
                              !!subagentTraceState(group.key, activity.activityId)?.expanded
                            "
                            :disabled="subagentTraceState(group.key, activity.activityId)?.loading"
                            @click.stop="toggleSubagentTrace(group.key, activity.activityId)"
                          >
                            <Loader2
                              v-if="subagentTraceState(group.key, activity.activityId)?.loading"
                              class="spin"
                              :size="13"
                            />
                            <ChevronDown
                              v-else-if="subagentTraceState(group.key, activity.activityId)?.expanded"
                              :size="13"
                            />
                            <ChevronRight v-else :size="13" />
                            {{
                              subagentTraceState(group.key, activity.activityId)?.expanded
                                ? t("common.collapse")
                                : t("common.view")
                            }}
                            {{ t("analysis.loopWorkerTrace") }}
                          </button>
                          <div
                            v-if="subagentTraceState(group.key, activity.activityId)?.expanded"
                            class="message-trace-list"
                          >
                            <div
                              v-if="subagentTraceState(group.key, activity.activityId)?.error"
                              class="loop-trace-error"
                            >
                              {{ t("analysis.loopWorkerTraceLoadFailed") }}
                            </div>
                            <div
                              v-else-if="
                                subagentTraceState(group.key, activity.activityId)?.trace?.error
                              "
                              class="loop-trace-error"
                            >
                              {{ subagentTraceState(group.key, activity.activityId)?.trace?.error }}
                            </div>
                            <div
                              v-else-if="
                                !subagentTraceState(group.key, activity.activityId)?.loading &&
                                !subagentTraceState(group.key, activity.activityId)?.trace?.messages
                                  .length
                              "
                              class="loop-trace-empty"
                            >
                              {{ t("common.noData") }}
                            </div>
                            <AgentMessageTrace
                              v-if="
                                subagentTraceState(group.key, activity.activityId)?.trace?.messages
                                  .length
                              "
                              :messages="
                                subagentTraceState(group.key, activity.activityId)?.trace?.messages ||
                                []
                              "
                              variant="worker"
                            />
                          </div>
                        </div>
                        <AgentMessageTrace
                          v-if="
                            isLoopActivityExpanded(group.key, activity) &&
                            loopViews[gi]!.stepTools.get(activity.activityId)
                          "
                          class="loop-tool-trace"
                          :messages="loopViews[gi]!.stepTools.get(activity.activityId) || []"
                          variant="turn"
                        />
                      </div>
                    </div>
                  </div>
                  <!-- Tool records with no producing activity: kept once here, not claimed by this stretch -->
                  <div v-if="entry.otherTools.length" class="loop-other-tools">
                    <button
                      type="button"
                      class="loop-trace-toggle"
                      :aria-expanded="!!expandedLoopProcesses[`${entry.key}|other`]"
                      @click="toggleLoopProcess(`${entry.key}|other`)"
                    >
                      <ChevronDown v-if="expandedLoopProcesses[`${entry.key}|other`]" :size="13" />
                      <ChevronRight v-else :size="13" />
                      {{ t("analysis.loopOtherToolRecords") }}
                    </button>
                    <AgentMessageTrace
                      v-if="expandedLoopProcesses[`${entry.key}|other`]"
                      class="loop-tool-trace"
                      :messages="entry.otherTools"
                      variant="turn"
                    />
                  </div>
                </div>
              </div>
            </template>
          </template>

          <!-- Step cards (Dimension orchestration: preserved as baseline) -->
          <div v-if="showStepCards(group.payload)" class="analysis-steps">
            <div v-for="(step, i) in analysisSteps(group.payload)" :key="i" class="step-card">
              <div class="step-card-header">
                <div class="step-icon" :class="step.status">
                  <CheckCircle2 v-if="step.status === 'done'" :size="12" />
                  <Zap v-else-if="step.status === 'active'" :size="12" />
                  <CircleSlash v-else-if="step.status === 'stopped'" :size="12" />
                  <Clock v-else :size="12" />
                </div>
                <span class="step-name" :class="step.status">
                  {{ step.name }}
                  <template v-if="step.status === 'done'">— {{ t("analysis.completed") }}</template>
                  <template v-if="step.status === 'active'">
                    — {{ t("common.inProgress") }}
                  </template>
                  <template v-if="step.status === 'stopped'">
                    — {{ t("analysis.analysisStopped") }}
                  </template>
                </span>
              </div>
              <div class="step-detail">{{ step.detail }}</div>
            </div>

            <!-- Keep the original compact progress list while analysis is running. -->
            <div
              v-if="thinkingTree(group.payload).length > 0 && !hasCompletedAnalysis(group.payload)"
              class="thinking-tree"
            >
              <div
                v-for="(dim, di) in thinkingTree(group.payload)"
                :key="dim.dimensionId || di"
                class="tree-dimension"
              >
                <div class="tree-dim-header">
                  <div
                    class="tree-dim-icon"
                    :class="{
                      done: dim.status === 'completed',
                      running: dim.status === 'running',
                      stopped: dim.status === 'stopped',
                    }"
                  >
                    <CheckCircle2 v-if="dim.status === 'completed'" :size="12" />
                    <Zap v-else-if="dim.status === 'running'" :size="12" />
                    <CircleSlash v-else-if="dim.status === 'stopped'" :size="12" />
                    <Clock v-else :size="12" />
                  </div>
                  <span class="tree-dim-name">{{ di + 1 }}. {{ dim.dimName }}</span>
                </div>
                <div v-if="dim.reason" class="tree-dim-reason">{{ dim.reason }}</div>
                <div v-if="dim.questions?.length" class="tree-questions">
                  <div
                    v-for="(q, qi) in dim.questions"
                    :key="q.id || qi"
                    class="tree-question"
                    :class="{
                      done: q.status === 'completed',
                      running: q.status === 'running',
                      failed: q.status === 'failed',
                      stopped: q.status === 'stopped',
                    }"
                  >
                    <div class="tree-q-status">
                      <CheckCircle2 v-if="q.status === 'completed'" :size="10" />
                      <Zap v-else-if="q.status === 'running'" :size="10" class="spin" />
                      <CircleSlash v-else-if="q.status === 'stopped'" :size="10" />
                      <Clock v-else :size="10" />
                    </div>
                    <span class="tree-q-text">{{ q.text }}</span>
                    <span
                      v-if="q.statusText"
                      class="tree-q-status-text"
                      :class="{ error: q.status === 'failed' }"
                    >
                      {{ q.statusText }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <DeepAnalysisResult
              v-if="thinkingTree(group.payload).length > 0 && hasCompletedAnalysis(group.payload)"
              :key="task?.id || streamingSnapshot?.runId || 'analysis'"
              class="chat-provenance-result"
              :activities="loopActivities(group.payload)"
              :run-state="group.payload?.runState"
              :archived="!group.streaming"
              :compact="true"
              :execution-scope="executionScope(group)"
            />
          </div>

          <div v-if="groupAnswer(group)" class="chat-msg assistant">
            <div
              class="chat-bubble assistant"
              :class="{ 'loop-bubble': isLoopMode(group.payload) }"
            >
              <AnalysisMessageBody :content="groupAnswer(group)" :charts="group.payload?.charts" />
            </div>
          </div>

          <!-- Follow-up turn streaming tail: show the typing cursor while the body is still growing -->
          <div v-if="group.streaming && group.streamingText !== ''" class="chat-msg assistant">
            <div class="chat-bubble assistant streaming">
              <div class="markdown-body markdown-content" v-html="renderMarkdown(group.streamingText)"></div>
              <span class="typing-cursor">|</span>
            </div>
          </div>

          <!-- Completed notice: only prompt once after the last turn of a report run closes with a report artifact -->
          <div v-if="showCompletedNotice(group, gi)" class="chat-msg system">
            <div class="chat-bubble system completed-notice">
              <div class="completed-icon-wrapper">
                <CheckCircle2 :size="16" />
              </div>
              <span>
                {{ t("analysis.analysisDoneHint") }}
              </span>
            </div>
          </div>

          <!-- Stopped notice -->
          <div v-if="showStoppedNotice(group, gi)" class="chat-msg system">
            <div class="chat-bubble system stopped-notice">
              <div class="stopped-icon-wrapper">
                <CircleSlash :size="16" />
              </div>
              <span>
                {{ t("analysis.analysisStoppedHint") }}
                <template v-if="isLoopMode(group.payload) && group.payload?.runState.error">
                  · {{ group.payload.runState.error }}
                </template>
              </span>
            </div>
          </div>

          <!-- Failed notice for loop turns -->
          <div v-if="showFailedNotice(group)" class="chat-msg system" role="alert">
            <div class="chat-bubble system failed-notice">
              <div class="failed-icon-wrapper">
                <CircleSlash :size="16" />
              </div>
              <span>
                {{ t("analysis.analysisFailed") }}
                <template v-if="group.payload?.runState.error">
                  · {{ group.payload.runState.error }}
                </template>
              </span>
            </div>
          </div>

          <!-- Diagnosis entry: a secondary tool after the turn and its closing notice, bound to this turn -->
          <TurnDiagnoseButton
            v-if="group.assistant?.snapshot"
            class="ui-icon-btn turn-diagnose-btn"
            :turn="group.assistant.snapshot"
          />
        </template>

        <div v-if="isLoopExecuting" class="loop-running-indicator" role="status" aria-live="polite">
          <Loader2 :size="16" class="spin" aria-hidden="true" />
          <span>{{ t("common.inProgress") }}</span>
        </div>

        <!-- Scheduled task notice -->
        <div
          v-if="
            messages.length === 0 && !isLoading && !streamingSnapshot && task?.status === 'pending'
          "
          class="chat-msg system"
        >
          <div class="chat-bubble system scheduled-notice">
            <div class="scheduled-icon-wrapper">
              <Clock :size="16" />
            </div>
            <span>
              {{ t("analysis.scheduledTaskHint") }}
              <br />
              {{ t("analysis.scheduledLastResult") }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.analysis-chat-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: color-mix(in srgb, var(--el-bg-color) 30%, var(--el-bg-color-page) 70%);
}

.chat-empty {
  flex: 1;
  width: 100%;
}

.ai-skeleton {
  width: 100%;
  padding: 40px;
}

.messages-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.messages-inner {
  padding: 20px 24px 0;
}

.turn-diagnose-btn {
  display: flex;
  margin: -6px 0 16px;
  border-radius: 10px;
}

.turn-diagnose-btn:hover {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
}

.chat-msg {
  margin-bottom: 16px;
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.chat-msg.user {
  display: flex;
  justify-content: flex-end;
}

.run-switcher-row {
  display: flex;
  justify-content: flex-end;
  margin: -10px 4px 10px 0;
}

.run-switcher {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.run-switcher .run-index {
  line-height: 28px;
}

.run-switcher button {
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font-size: 18px;
  line-height: 24px;
  cursor: pointer;
}

.run-switcher button:hover:not(:disabled) {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.run-switcher button:disabled {
  opacity: 0.3;
  cursor: default;
}

.chat-msg.system {
  display: flex;
  justify-content: flex-start;
}

.chat-bubble {
  max-width: 85%;
  padding: 12px 16px;
  border-radius: 14px;
  font-size: 13px;
  line-height: 1.6;
}

.chat-bubble.system {
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  border: 1px solid var(--el-border-color);
  border-radius: 18px;
  box-shadow: var(--shadow-card);
}

.chat-bubble.user {
  background: var(--el-color-primary);
  color: var(--on-primary);
  border-radius: 14px 14px 4px 14px;
}

.streaming-text,
.summary-text {
  white-space: pre-wrap;
  word-break: break-word;
}

/* Step Cards */
.analysis-steps {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.step-card {
  background: var(--el-bg-color);
  border-radius: 18px;
  padding: 14px 16px;
  border: 1px solid var(--el-border-color);
  box-shadow: var(--shadow-card);
  transition: all 0.3s ease;
}

.step-card:hover {
  border-color: var(--el-border-color-dark);
  box-shadow: var(--shadow-card-hover);
}

.step-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.step-icon {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.step-icon.done {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success);
}

.step-icon.active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  animation: breathe 2s ease-in-out infinite;
}

.step-icon.pending {
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
}
.step-icon.stopped {
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning);
}
.step-icon.failed {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}

@keyframes breathe {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.step-name {
  font-size: 13px;
  font-weight: 600;
}

.step-name.done {
  color: var(--el-color-success);
}

.step-name.active {
  color: var(--el-color-primary);
}

.step-name.pending {
  color: var(--el-text-color-secondary);
}
.step-name.stopped {
  color: var(--el-color-warning);
}
.step-name.failed {
  color: var(--el-color-danger);
}

.step-detail {
  font-size: 12px;
  color: var(--el-text-color-regular);
  line-height: 1.6;
  padding-left: 30px;
}

/* Loop execution process: one collapsed card per turn */
.loop-process {
  margin-bottom: 16px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  border-radius: 18px;
  box-shadow: var(--shadow-card);
  overflow: hidden;
}

.loop-process-toggle {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  width: 100%;
  padding: 10px 16px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.loop-process-toggle:hover {
  background: var(--el-fill-color-light);
}

.loop-process-chevron {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
}

.loop-process-summary {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.loop-process-failures {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-color-danger);
}

.loop-process-body {
  border-top: 1px solid var(--el-border-color-lighter);
}

.loop-timeline {
  display: flex;
  flex-direction: column;
  padding: 14px 16px;
}

.loop-timeline-item {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding-bottom: 14px;
  min-width: 0;
}

.loop-timeline-item:last-child {
  padding-bottom: 0;
}

.loop-timeline-item:not(:last-child)::before {
  content: "";
  position: absolute;
  left: 9px;
  top: 22px;
  bottom: 0;
  width: 2px;
  background: var(--el-border-color-lighter);
}

.loop-rail {
  width: 20px;
  display: flex;
  justify-content: center;
  flex-shrink: 0;
  position: relative;
  z-index: 1;
}

.loop-item-body {
  flex: 1;
  min-width: 0;
}

.loop-step-title {
  min-width: 0;
  overflow-wrap: anywhere;
}

.loop-step-state {
  font-size: 11px;
  font-weight: 500;
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
}

.loop-step-state.running {
  color: var(--el-color-primary);
}

.loop-step-state.failed {
  color: var(--el-color-danger);
}

.loop-step-state.cancelled {
  color: var(--el-color-warning);
}

.loop-step-detail {
  padding-left: 0;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
  overflow-wrap: anywhere;
  word-break: break-word;
}

.loop-step-detail.is-tool-meta {
  margin-top: 6px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-extra-light);
  color: var(--el-text-color-regular);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11.5px;
  line-height: 1.55;
}

.loop-step-detail.is-error {
  color: var(--el-color-danger);
}

.loop-narrative,
.loop-worker-summary {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.loop-questions-box {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-extra-light);
}

.tree-question.loop-question-row {
  align-items: flex-start;
  padding: 5px 6px;
}

.loop-worker-summary.markdown-body {
  margin-top: 4px;
  color: var(--el-text-color-regular);
  font-size: 12.5px;
  line-height: 1.65;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.loop-tool-trace {
  margin-top: 8px;
}

.loop-other-tools {
  padding: 0 16px 14px;
}

.loop-other-tools:first-child {
  padding-top: 6px;
}

.loop-process .tree-q-text {
  min-width: 0;
  overflow-wrap: anywhere;
}

.loop-question-row .tree-q-status {
  min-height: 1.6em;
}

.loop-question-row .tree-q-status-text {
  max-width: 100%;
  overflow-wrap: anywhere;
}

/* Thinking Tree */
.thinking-tree {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 16px;
}

.chat-provenance-result {
  margin-bottom: 16px;
}

.chat-provenance-result :deep(.thinking-header) {
  display: none;
}

.chat-provenance-result :deep(.thinking-tree) {
  background: transparent;
  border: none;
}

.chat-provenance-result :deep(.tree-container) {
  gap: 10px;
}

.tree-dimension {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  border-radius: 18px;
  padding: 12px 14px;
  box-shadow: var(--shadow-card);
}

.tree-dim-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.loop-activity-header {
  width: 100%;
  padding: 2px 4px;
  margin-left: -4px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.loop-activity-header:hover:not(:disabled) {
  background: var(--el-fill-color-light);
}

.loop-activity-header:disabled {
  cursor: default;
}

.loop-process-toggle:focus-visible,
.loop-activity-header:focus-visible,
.loop-trace-toggle:focus-visible {
  outline: 2px solid var(--el-color-primary-light-3);
  outline-offset: 3px;
}

.loop-expand-icon {
  flex-shrink: 0;
  margin-left: auto;
  color: var(--el-text-color-secondary);
}

.tree-dim-icon {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.tree-dim-icon.done {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success);
}
.tree-dim-icon.running {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
.tree-dim-icon.stopped {
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning);
}
.tree-dim-icon.failed {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}
.tree-dim-icon {
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
}

.tree-dim-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.tree-dim-reason {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
  padding-left: 28px;
}

.tree-questions {
  margin-top: 8px;
  padding-left: 28px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tree-question {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 12px;
}

.loop-query-execution {
  flex-basis: 100%;
  min-width: 0;
  margin: 6px 0 2px;
}

.tree-q-status {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.tree-q-status :deep(svg) {
  color: var(--el-text-color-secondary);
}

.tree-question.done .tree-q-status :deep(svg) {
  color: var(--el-color-success);
}
.tree-question.running .tree-q-status :deep(svg) {
  color: var(--el-color-primary);
}
.tree-question.failed .tree-q-status :deep(svg) {
  color: var(--el-color-danger);
}

.tree-q-text {
  color: var(--el-text-color-regular);
  flex: 1;
}

.tree-question.done .tree-q-text {
  color: var(--el-color-success);
}
.tree-question.running .tree-q-text {
  color: var(--el-color-primary);
  font-weight: 500;
}
.tree-question.failed .tree-q-text {
  color: var(--el-color-danger);
}
.tree-question.stopped .tree-q-status :deep(svg) {
  color: var(--el-color-warning);
}
.tree-question.stopped .tree-q-text {
  color: var(--el-color-warning);
}

.tree-q-status-text {
  font-size: 10px;
  color: var(--el-text-color-secondary);
}

.tree-q-status-text.error {
  color: var(--el-color-danger);
}

.loop-dispatch-detail {
  margin: 8px 0 0;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background: var(--el-fill-color-extra-light);
}

.loop-detail-field + .loop-detail-field {
  margin-top: 8px;
}

.loop-detail-field > span {
  font-size: 11px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
}

.loop-detail-field > p {
  margin: 2px 0 0;
  color: var(--el-text-color-regular);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.loop-trace-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  margin-top: 8px;
  padding: 4px 8px;
  border: 1px solid var(--el-border-color);
  border-radius: 7px;
  background: var(--el-bg-color);
  color: var(--el-color-primary);
  font-size: 12px;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    background-color 0.2s ease;
}

.loop-trace-toggle:hover:not(:disabled) {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
}

.loop-trace-toggle:disabled {
  cursor: wait;
  opacity: 0.72;
}

.message-trace-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.loop-trace-error,
.loop-trace-empty {
  padding: 8px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.loop-trace-error {
  color: var(--el-color-danger);
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Bar chart in step */
.step-chart {
  margin-top: 10px;
  margin-left: 30px;
  background: var(--el-bg-color);
  border-radius: 10px;
  padding: 12px 16px;
  border: 1px solid var(--el-border-color);
}

.bar-chart {
  display: flex;
  align-items: flex-end;
  justify-content: space-around;
  height: 120px;
  gap: 8px;
}

.bar-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex: 1;
}

.bar {
  width: 100%;
  max-width: 40px;
  border-radius: 6px 6px 0 0;
  transition: height 0.6s ease;
  min-height: 4px;
}

.bar-label {
  font-size: 9px;
  color: var(--el-text-color-secondary);
  font-weight: 500;
}

.bar-value {
  font-size: 8px;
  color: var(--el-text-color-secondary);
}

/* Completed, stopped, and failed notices */
.completed-notice,
.scheduled-notice,
.stopped-notice,
.failed-notice {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.completed-icon-wrapper {
  color: var(--el-color-success);
  flex-shrink: 0;
  margin-top: 1px;
}

.stopped-icon-wrapper {
  color: var(--el-color-warning);
  flex-shrink: 0;
  margin-top: 1px;
}

.failed-icon-wrapper {
  color: var(--el-color-danger);
  flex-shrink: 0;
  margin-top: 1px;
}

.scheduled-icon-wrapper {
  color: var(--el-color-warning);
  flex-shrink: 0;
  margin-top: 1px;
}

.follow-up-section {
  margin-top: 24px;
}

.follow-up-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.follow-up-divider::before,
.follow-up-divider::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--el-border-color-light);
}

.follow-up-pair {
  margin-bottom: 16px;
}

.follow-up-pair .chat-bubble.user {
  margin-bottom: 8px;
}

.chat-bubble.assistant {
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  border: 1px solid var(--el-border-color);
  border-radius: 12px;
  padding: 12px 16px;
  font-size: 14px;
  line-height: 1.7;
  max-width: 85%;
  align-self: flex-start;
  box-shadow: var(--shadow-card);
}

/* Loop-turn body text shares the process blocks' content width on every screen size. */
.chat-bubble.assistant.loop-bubble {
  max-width: none;
}

.markdown-body {
  font-size: 14px;
  line-height: 1.7;
}

.markdown-body :deep(p) {
  margin: 0 0 8px;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin: 8px 0;
  padding-left: 22px;
}

.markdown-body :deep(li) {
  margin: 4px 0;
  line-height: inherit;
}

.markdown-body :deep(li > p),
.markdown-body :deep(li > ul),
.markdown-body :deep(li > ol) {
  margin-top: 4px;
  margin-bottom: 4px;
}

.markdown-body :deep(> :first-child) {
  margin-top: 0;
}

.markdown-body :deep(> :last-child) {
  margin-bottom: 0;
}

.markdown-body :deep(code) {
  background: var(--el-fill-color);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 0.9em;
}

.markdown-body :deep(pre) {
  background: var(--el-fill-color);
  padding: 8px 12px;
  border-radius: 6px;
  overflow-x: auto;
  font-size: 13px;
  margin: 8px 0;
}

.markdown-body :deep(pre code) {
  background: none;
  padding: 0;
}

.markdown-body :deep(table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  margin: 12px 0;
}

.markdown-body :deep(th),
.markdown-body :deep(td) {
  padding: 8px 12px;
}

.chat-bubble.assistant.streaming {
  border-color: var(--el-color-primary-light-3);
}

.typing-cursor {
  display: inline-block;
  animation: blink 1s step-end infinite;
  color: var(--el-color-primary);
  font-weight: bold;
}

@keyframes blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}

.streaming-dots {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
}

.loop-running-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 0 18px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

@media (prefers-reduced-motion: reduce) {
  .loop-running-indicator .spin {
    animation: none;
  }
}

.streaming-dots span {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--el-color-primary) 72%, white 28%);
  opacity: 0.24;
  animation: streaming-glow 1.2s ease-in-out infinite;
}

.streaming-dots span:nth-child(2) {
  animation-delay: 0.18s;
}

.streaming-dots span:nth-child(3) {
  animation-delay: 0.36s;
}

@keyframes streaming-glow {
  0%,
  80%,
  100% {
    opacity: 0.24;
    background: color-mix(in srgb, var(--el-color-primary) 68%, white 32%);
    box-shadow: 0 0 0 rgba(37, 99, 235, 0);
  }
  40% {
    opacity: 1;
    background: var(--el-color-primary);
    box-shadow: 0 0 10px rgba(37, 99, 235, 0.32);
  }
}

.messages-scroll::-webkit-scrollbar {
  width: 4px;
}

.messages-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.messages-scroll::-webkit-scrollbar-thumb {
  background: var(--el-border-color-dark);
  border-radius: 4px;
}

.messages-scroll::-webkit-scrollbar-thumb:hover {
  background: var(--el-text-color-secondary);
}
@media (max-width: 700px) {
  :where(html.workbench-mobile-navigation) .messages-inner {
    padding: 12px 10px 0;
  }
  :where(html.workbench-mobile-navigation) .ai-skeleton {
    padding: 20px 12px;
  }
  :where(html.workbench-mobile-navigation) .chat-msg {
    margin-bottom: 12px;
  }
  :where(html.workbench-mobile-navigation) .chat-bubble {
    max-width: 94%;
    padding: 10px 12px;
  }
  :where(html.workbench-mobile-navigation) .chat-bubble.system {
    border-radius: 14px;
  }
  :where(html.workbench-mobile-navigation) .analysis-steps {
    gap: 8px;
  }
  :where(html.workbench-mobile-navigation) .step-card {
    padding: 12px;
    border-radius: 14px;
  }
  :where(html.workbench-mobile-navigation) .loop-process {
    border-radius: 14px;
  }
  :where(html.workbench-mobile-navigation) .loop-process-toggle,
  :where(html.workbench-mobile-navigation) .loop-timeline {
    padding: 10px 12px;
  }
  :where(html.workbench-mobile-navigation) .loop-other-tools {
    padding: 0 12px 10px;
  }
  :where(html.workbench-mobile-navigation) .run-switcher-row {
    margin-right: 0;
  }
}
</style>
