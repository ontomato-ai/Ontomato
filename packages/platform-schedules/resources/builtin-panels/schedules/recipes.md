# 任务触发

这一页是平台侧栏（`/schedules`）与本体管理器能力层（`/ontology/assets/triggers`）共用的「任务触发」面板，列出当前读者在域内有权查看的任务触发（`platform:Trigger`），覆盖动作、流程、智能体、运维诊断与知识治理五类目标。

## 页面上有什么

- `appFilter.counts`：按目标类型分组的数量（`platform:Trigger.counts`，`by: "targetKind"`：全部、应用、动作、流程）。
- `tasks.rows`：可读的任务触发卡片列表（`platform:Trigger.catalogue`）。每行 `fields` 包含 `targetKind`（`application` / `action` / `workflow`）、`targetId`、`targetName`、`status`（`PENDING_REVIEW` / `PUBLISHED` / `UNUSED`）、`definitionStatus`、`version`（发布版本）、`reviewedBy`（审阅人）、`executorId`（到点执行人）、`coauthorIds`（共同作者）、`settings`、`state`、`stateLabel`、`pauseReason`、`pauseCode`、`nextRun`、`lastRun`、`frequency`、`timeZone`、`notifyEmail`、`lastRunAt`、`lastRunSummary` 与 `latestResultPath`。
- 状态 `app`：按目标类型（`application` / `action` / `workflow`）或应用 ID 筛选，空为全部。
- 状态 `status`：按定义状态（`PENDING_REVIEW` / `PUBLISHED` / `UNUSED`）筛选，空为全部。
- 状态 `search`：按标题、目标名称、配置摘要或频率搜索。
- 状态 `selectedTask`：选中的任务触发。选中后：
  - `detailHeader.record` / `detailSummary.record` / `detailPause.record`：触发记录（`platform:Trigger.record`），并在 `outputs` 上提供 `revision`、`definitionStatus`、`targetKind`、`enabled`、`paused`、`pauseCode`、`latestResultPath`、`isRunning`。
  - `history.rows`：运行记录分页列表（`platform:Trigger.runRecords`，新到旧，`cursor` 取上一页的 `nextCursor`），每条区分 `executorId`（实际执行人）、`version`（运行版本）、`workflowRunId`（工作流运行 ID），且工作流启动成功显示「已启动流程」而非「完成」。
- 状态 `runId`：定位到一条运行。`focus` 是嵌套面板 `builtin-product-scheduled-task-run-detail`，`runDetail` 是该运行的详细摘要（`platform:Trigger.runRecord`）。
- 状态 `compose`：`"new"` 打开新建表单（`newForm`），`"edit"` 打开选中触发的编辑表单（`editForm`）。

打开某个状态的地址：使用扁平具名参数，例如 `/schedules?app=workflow`、`/schedules?selectedTask=<触发ID>`，或加 `&runId=<运行ID>` 打开某条运行；在本体管理器入口同理位于 `/ontology/assets/triggers`。

## 回答问题

先读 `tasks.rows`；问到某条触发的详细配置、版本、审阅人、执行人、共同作者或最近运行记录时，读选中触发的 `detailSummary.record` / `editForm.form` 和 `history.rows`，不要猜。

## 新建与编辑任务触发

**编辑**：用 `present` 设置 `selectedTask` 为 `{ className: "platform:Trigger", primaryKey: "<触发ID>" }` 且 `compose: "edit"` 打开表单。读 `editForm.form` 确认字段，再用 `fill_form({ member: "editForm", values })` 填写。`task` 下是标题、说明、目标类别（`targetKind`）、目标（`appId` 或 `targetId`）、原生目标参数（`capabilityContent`）、到点执行人（`executorId`）、共同作者（`coauthorIds`）、频率、时区和通知邮箱；应用能力自己的参数在根上。

**新建**：用 `present` 设置 `selectedTask: null` 与 `compose: "new"` 打开新建表单。读 `newForm.createForm`，用 `fill_form({ member: "newForm", values })` 填写。先定 `task.targetKind` 与 `task.appId` / `task.targetId`（改动带 `refreshOnChange` 的选项后按更新后的表单填）。`task.enabled` 为 `true` 时直接发布并启用（需有相应发布资格），为 `false` 时保存为待审核（`PENDING_REVIEW`）。

频率五种写法：`{"kind":"interval","every":2,"unit":"hour"}`（unit 为 minute/hour/day）、`{"kind":"daily","time":"09:00"}`、`{"kind":"weekly","weekday":1,"time":"09:00"}`（1=周一…7=周日）、`{"kind":"monthly","day":1,"time":"09:00"}`、`{"kind":"cron","expression":"0 30 2 * * *"}`（六段，秒在最前）。时区用 IANA 名称，如 `Asia/Shanghai`。

填好后留在页面上供用户核对。用户要求保存时，新建用 `page_action({ operation: "newForm.create" })`，编辑用 `page_action({ operation: "editForm.save" })`，默认在对话中确认。修订号冲突时请用户在表单里点“载入最新”核对后再保存。

## 执行操作（走确认）

对选中任务触发调用已声明的操作，等用户确认：

- 发布 / 设为未使用：`opSetStatus.setStatus`（或卡片 `tasks.publish` / `tasks.unuse`），输入 `{"status":"PUBLISHED"|"UNUSED"|"PENDING_REVIEW","enabled":true|false,"revision":<revision>}`。
- 启用 / 停用：`opEnable.setEnabled`，输入 `{"enabled":true|false,"revision":<revision>}`（仅已发布的触发可启用）。
- 立即运行：`opRunNow.runNow`，输入 `{}`。手动运行以点击者身份执行，不改变原定时计划。工作流触发启动成功时结果为「已启动流程」。被拒绝码 `TASK_RUNNING` 表示已在运行，给出带 `runId` 的地址让用户看那条记录。
- 删除：`opDelete.delete`，输入 `{"revision":<revision>}`。删除不可恢复，运行记录一并删除；确认时说清标题。
- 凭证续期：`renew.renewCredential`（页面在检测到 `credentialStatus === "renewal-required"` 时自动触发）。
