# 定时任务

这一页列出**当前读者本人创建的**定时任务（`platform:ScheduledTask`）。所有读写都由定时任务服务按读者本人的权限判；看不到别人的任务，也不要替别人操作。

## 页面上有什么

- `tasks.rows`：本人的全部任务。每行 `fields` 有 `application`（应用 ID）、`settings`（应用给出的配置摘要）、`state`（`on`、`off` 或 `paused: 原因`）、`nextRun`（下次运行时间）、`lastRun`（最近一次运行的状态）、`frequency`、`timeZone`、`lastRunAt`、`lastRunSummary` 和 `latestResultPath`。
- 状态 `app`：按应用筛选（应用 ID，空为全部）。
- 状态 `search`：按标题搜索（字符串，空字符串为全部标题）。
- 状态 `selectedTask`：选中的任务。选中后：
  - `detail.record`：任务记录；`detail.form`：属主表单，`values.task` 里是标题、应用、频率、时区、通知邮箱，根上是应用自己的参数；`revision` 是当前修订号。
  - `history.runs`：执行记录，新到旧，一页一页（`cursor` 取上一页的 `nextCursor`）。每条有状态、触发方式、开始时间、耗时（毫秒）、失败原因 `error`、结果摘要、结果链接 `resultLink`、执行详情 `executionDetails` 和运行时的配置 `snapshot`。
- 状态 `runId`：定位到一条运行（`focus.run`）。
- 状态 `compose`：`"new"` 打开新建表单（`newForm`），`"edit"` 打开选中任务的编辑表单（`editForm`）。用 `present` 设置这一公开状态。
- 应用名来自 `apps.catalog`；可选应用、是否可用及不可用原因来自 `choices.form` 里 `/task/appId` 字段的选项。

打开某个状态的地址：使用扁平具名参数，例如 `/schedules?app=agents`、`/schedules?selectedTask=<任务ID>`，或再加 `&runId=<运行ID>` 打开某条运行。

## 回答问题

先读 `tasks.rows`；问到某个任务的频率、时区、通知邮箱或最近的结果时，读选中任务的 `detail.form` 和 `history.runs`，不要猜。时间按任务时区说。

## 填写定时任务

**编辑**：用 `present({ target: "/schedules", state: { selectedTask: { className: "platform:ScheduledTask", primaryKey: "<任务ID>" }, compose: "edit" } })` 打开指定任务的表单。读 `editForm` 的 `form` 确认字段，再用 `fill_form({ member: "editForm", values })` 填写。`task` 下是标题、应用、频率、时区和通知邮箱，根上是应用自己的参数。

**新建**：用 `present({ target: "/schedules", state: { selectedTask: null, compose: "new" } })` 打开新建表单。读 `newForm` 的 `createForm`，用 `fill_form({ member: "newForm", values })` 填写。先定 `task.appId`，按表单实际返回的应用字段填参数（换应用或改了带 `refreshOnChange` 的选项后，按更新后的表单填）。新建的任务保存后直接启用。不可用的应用（选项 `disabled`）不要选，把 `disabledReason` 告诉用户。

频率五种写法：`{"kind":"interval","every":2,"unit":"hour"}`（unit 为 minute/hour/day）、`{"kind":"daily","time":"09:00"}`、`{"kind":"weekly","weekday":1,"time":"09:00"}`（1=周一…7=周日）、`{"kind":"monthly","day":1,"time":"09:00"}`（没有这天的月份在最后一天运行）、`{"kind":"cron","expression":"0 30 2 * * *"}`（六段，秒在最前）。时区用 IANA 名称，如 `Asia/Shanghai`。通知邮箱可留空。

填好后留在页面上供用户核对。用户要求保存时，新建用 `page_action({ operation: "newForm.create" })`，编辑用 `page_action({ operation: "editForm.save" })`，默认在对话中确认。保存被拒绝时表单保留输入并显示原因。修订号冲突时请用户在表单里点“放弃”载入最新内容，核对后再保存。

## 执行操作（走确认）

对选中任务（`target` 为该任务）调用已声明的操作，等用户确认：

- 启用/停用：`opEnable.setEnabled`，输入 `{"enabled":true|false,"revision":<detail.form 的 revision>}`。启用后若仍暂停，告诉用户原因。
- 立即运行：`opRunNow.runNow`，输入 `{}`。只多跑一次，原定时计划照旧。结果是运行记录：`running` 已开始、`completed` 完成、`skipped` 跳过、`failed` 失败（说出原因）。被拒绝码 `TASK_RUNNING` 表示已在运行，给出带 `runId` 的地址让用户看那条记录。
- 删除：`opDelete.delete`，输入 `{"revision":<revision>}`。删除不可恢复，执行记录也一并删除；确认时说清任务标题。

修订号冲突（`REVISION_CONFLICT`）时重新读 `detail.form` 取最新修订号，并把变化告诉用户后再做。
