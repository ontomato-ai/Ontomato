---
name: ontomato-process-operator
description: 以使用方主体身份在 Ontomato/Praxis 上办事：按需求找到自己有权执行的动作或流程步骤，执行 Action 推动业务对象，或者从 Praxis 待办里审批/指派推动 Run；需要一次性流程时创建临时 Workflow。用于「我现在能办什么」「帮我发起/审批这个单」「把这条流程走完」「临时搭一条流程」这类任务。
---

# Ontomato 流程使用方

这个技能只做一件事：**以当前登录人的身份，把一件已经在流程里的事办掉，或者临时搭一条能办完的流程。**

它不负责设计公司固定流程、建组织/角色/权限；那是 `ontomato-process-admin` 的事。

---

## 0. 先分清两条执行路径

平台里同时存在两种“推进”方式，它们不是同一件事：

| | Ontomato 拉式 | Praxis 账本 |
|---|---|---|
| 谁决定轮到谁 | Action 的 `submissionCriteria`（状态/节点/负责人） | Run 的 step 状态 + `assigned_to`/`assignee` + 目录 |
| 怎么推进 | 你直接执行那一步的 Action | 你在 `/inbox` 看到 waiting 步，`/steps/:id/decide` |
| 有没有账本 | 没有；业务对象自己记状态 | 有；`workflow_run`/`step_run`/事件 |
| 适合 | 固定流程的日常办理 | 需要审计、待办、审批记录、跨系统触发 |

**不要对同一件事既 `run` 又 `decide`。** 如果这一步已经在 Praxis 的 Run 里，用 `inbox` → `decide`；直接 `run` 会绕过账本，甚至重复执行审批动作。

判断方法：

- `inbox` 里能看到这个 `stepId` → 走 Praxis；
- 只有一个业务对象、没有 `runId` → 走 Ontomato 拉式 `run`；
- 管理员用 Trigger 启动的 workflow → 先查 Praxis `runs`。

---

## 0.5 被要求办一件具体事时，按这个顺序

1. **先看自己**：`my-actions`、`workflow/query`、`template`、`inbox`。有能办的动作或待办，直接走第 5/6 节。
2. **自己办不了时，不要停在“没权限”**。先看自己的组织子树里谁能办：

   ```bash
   node client.mjs org-graph
   ```

   返回：
   - `units`：我的组织及所有下级组织；
   - `members`：这些组织里的主体，以及他们的有效角色；
   - `roles[].capabilities`：这些角色能执行的 Action（含 `name`、`classNames`）；
   - `roles[].canAuthorWorkflow`：该角色是否有保存/激活 Workflow 的平台权限。

3. 先用 `node client.mjs find "<需求>"` 找已发布的 Action。`denied` 里也会给出 `actionId/name`；**Action 已发布就可以用于临时 Workflow**，不要求当前角色已经持有它。
4. 再用 `org-graph` 选目标角色和成员：
   - `roles[].capabilities` 是**当前已授权**的能力，不是可用 Action 的全集；
   - 即使目标角色当前没有该 capability，只要 Action 已发布，也可以把它写进临时 Workflow 的步骤，激活时会落 `role × action` 授权；
   - 用 `roleCode` 填步骤的 `roleCode`，用 `loginCode/id` 选具体办理人。
5. 组装临时 Workflow：
   - 发起步用我有的 Action；办理步用目标角色的 Action；
   - `temp-save` 保存并激活，必要时 `start` 起 Run。
6. 如果没有任何已发布 Action 能覆盖，或我自己没有 `/workflow/save` + `/workflow/activate`：
   - 明确说明缺的是“可执行 Action”还是“流程保存/激活权限”；
   - 不要伪造能力，也不要用 `/role/getRoleInfoPage`、`/organization/snapshot` 等管理员接口代查。

---

## 1. 身份与授权

- 所有写操作都以**当前 token 的主体**为准：`requester`、`decider`、`assignedBy` 必须与 token 的 loginCode 一致。
- 不能伪造 `operator_id` 假装别人；授权是按 token 背后的账号算的。
- Ontomato 的 Action 授权来自“有效角色 → 岗位 → 权限”，以及“角色 × 动作”的流程授权；Praxis 只判“这一步是不是轮到你”。
- 没有权限时不要重试到成功；读错误信息，按提示去找管理员。

---

## 2. 前置条件

- 平台已起，`GET /health` 成功。
- 你在目标域有一个账号，且被授予了至少一个角色。
- 如果要走 Praxis：Praxis 已起（默认 `http://127.0.0.1:18600`），且该域已迁移过账本。
- 如果要建临时 Workflow：你的账号要有 workflow 保存/激活权限；没有就先用管理员技能。

## 认证（三选一，没有默认账号）

客户端支持三种认证方式：

1. **平台 token**：`ONTOMATO_TK`（兼容 `OA_TOKEN`，`OA_TOKEN` 显式设置时优先）；
   或 `node client.mjs login --token ***
2. **Ontomato API Key**：`ONTOMATO_API_KEY`（兼容 `OA_API_KEY`）；
   或 `node client.mjs login --api-key ***
3. **用户名+密码**：`OA_CODE` + `OA_PASS` + `OA_DOMAIN`；
   或 `node client.mjs login <code> <pass> [domainId]`。

平台 Agent 运行时通常已经注入：

```bash
ONTOMATO_TK            # 当前登录人的平台 token
ONTOMATO_API_KEY       # 使用 API Key 登录时注入（二选一）
ONTOMATO_ONTOLOGY_URL  # 数据引擎地址，作为默认 API 端点
```

先确认它们存在，再直接调用：

```bash
env | grep -E 'ONTOMATO_(TK|API_KEY|ONTOLOGY_URL)'
node client.mjs me
```

独立运行时（不在平台 Agent 内）可以显式设置；`OA_*` 仍可用作兼容/覆盖：

```bash
export PRAXIS_BASE=http://127.0.0.1:18600

# 平台 token（推荐）
export ONTOMATO_ONTOLOGY_URL=http://localhost:8080/api/data-query
export ONTOMATO_TK=<平台 token>

# 或用户名+密码
# export OA_DOMAIN=<域id>
# export OA_CODE=<你的登录名>
# export OA_PASS=<密码>
```

---

## 3. 阶段 0：确认身份与可达

```bash
node client.mjs login
node client.mjs me
node client.mjs ping
node client.mjs praxis-health
node client.mjs my-actions
```

`my-actions` 是后面所有判断的基础：

- 它取当前主体在域内的有效角色；
- 取所有 `ACTIVE` 流程的 `role × action` 授权，以及手工授予的 Action；
- 只保留 `status=PUBLISHED` 的动作；
- 输出每个动作的来源（`source=process|direct`）、流程 id、版本。

如果没有角色，`my-actions` 会明确说 “This subject holds no role in this domain.”，不要继续猜。

---

## 4. 按需求找“我能办什么”

### 4.1 语义找动作

```bash
node client.mjs find "我要请假两天"
node client.mjs find "审批研发部的采购申请" purchase_request
```

`find` 调 `/action/find`，再把结果与 `my-actions` 取交集：

- `allowed`：我有权限的动作；
- `denied`：平台找到了、但我没有权限的动作。不要对 `denied` 硬跑；它会返回 `notGranted` 或作用域错误。

### 4.2 看流程步骤

```bash
node client.mjs template <workflowId>
```

模板里的 `setup steps` 是冻结的步骤（`s1`、`s2`…），能看到每步的 `decider`、`assignee`、`capabilityRef`、`executor`。它不包含运行输入。

### 4.3 看平台待办

```bash
node client.mjs pending
node client.mjs pending 50 --flow <workflowId>
```

`pending` 执行的是管理员激活流程时生成的“我的待办”MetricView：

- 只有声明了 `runContract` 并成功生成查询的流程才有；
- 没有已发布待办查询时，会明确报错，不要把它当成“没有待办”；
- 行数据由服务端按角色、步骤、行权限过滤。

### 4.4 看 Praxis 待办

```bash
node client.mjs inbox
```

返回 waiting 步，包含：

```json
{
  "runId": "...",
  "stepId": "...",
  "stepRef": "s2",
  "assignee": "role:DEPT_LEADER",
  "assignedTo": null,
  "capabilityRef": "action:...",
  "input": { "...": "..." },
  "waitingSince": "..."
}
```

- 没有 `assignedTo` 表示池状步骤：按 `assignee` 表达式 + 目录判断你是否属于这个池；
- 目录不可达时只返回钉给你的步骤，不会失败。

---

## 5. 路径 A：Ontomato 拉式执行

### 5.1 执行动作

```bash
node client.mjs run act_leave_start '{
  "title":"10月客户拜访",
  "dept":"研发部",
  "days":"2",
  "reason":"客户现场"
}'
```

- 这是 `multipart` 的 `/action/execute`；参数按 Action 的 `function.parameters` 名字给。
- 缺参数会报 `Missing parameter: <name>`；`null` 是允许的，空串和 0 是真实值。
- 动作的 `submissionCriteria` 判定“现在是不是你的回合”；不是就返回前置条件失败。
- 授权、作用域、前置条件都在服务端；客户端不做二次判断。

### 5.2 按顺序推进

1. 发起人跑发起动作 → 拿到 `run_id`，业务对象进入第一步。
2. 每一步的负责人跑该步动作；每步后核对 `current_node` 和 `status`。
3. 驳回也要走一次：`decision/rejected` 或业务动作的驳回参数 → 状态变驳回且不再前进。

### 5.3 反面用例（必须知道）

- 不是你的回合：重复跑上一步动作 → 前置条件失败。
- 无权限：不持有该步角色的人跑 → `notGranted`。
- 作用域外：目标对象不在授权范围 → `Action.targetOutsideScope`。
- 动作未发布/已冻结：`Action.notPublished` / `publishedIsFrozen`。

---

## 6. 路径 B：Praxis 账本

### 6.1 起一个 Run

```bash
node client.mjs start <workflowId> '{"s1":{"title":"10月客户拜访","days":"2"}}'
node client.mjs start <workflowId> --no-auto
```

- `requester` 由当前 token 决定，不能替别人发起。
- `inputs` 按模板步骤 id（`s1`、`s2`）分组。
- 默认创建后立即 tick；`--no-auto` 只创建，之后用 `tick <runId>`。

### 6.2 绑定业务对象

第一个 fixed 步执行后会创建业务单。审批动作的 `run_id` 不是账本 Run id，而是**业务对象 id**：

```bash
node client.mjs bind <runId> leave_request <业务对象id>
```

- 绑定后审批动作才能把 `run_id` 传给业务 Action；
- 没有绑定、步骤输入里也没有 `run_id` 时，引擎会省略该字段，审批动作可能失败；
- 绑定是替换主引用，不追加。

### 6.3 审批 / 驳回

```bash
node client.mjs decide <stepId> approve "同意"
node client.mjs decide <stepId> reject "材料不全"
```

- 字段是 `verdict`（`approve|reject`），不是 `decision`。
- `decider` 由当前 token 决定；body 写别人会 403。
- 只有 `status=waiting` 的 human 步可以决定。
- 通过：引擎以决定人身份执行审批 Action，回写业务对象，Run 收口 `completed`。
- 驳回：同样执行 Action（带 `decision=rejected`），然后 step 失败、Run 失败。
- 被拒绝的尝试会写 `step.refused` 事件（审计）。

### 6.4 指派 / 候选人

```bash
node client.mjs candidates <stepId>
node client.mjs assign <stepId> dept_leader1
node client.mjs assign <stepId> --clear
```

- 指派是组织行为：`canAssign(assigner, principal)` 必须通过；不是所有角色都能把人钉到别人头上。
- 只对未执行的 human 步有效；清钉回到声明的池。
- `candidates` 的 `degraded=true` 表示“这个版本没有目录”，不是“这个角色没人”。

### 6.5 查看 Run

```bash
node client.mjs runs
node client.mjs runs waiting
node client.mjs run-status <runId>
```

`RunRecord` 里重点看：

- `status`：`pending/running/waiting/completed/failed/cancelled`
- `steps[].status`：`blocked/ready/running/waiting/done/failed`
- `steps[].assignedTo`：实际钉给谁
- `events[]`：`run.created`、`step.waiting`、`step.approved`、`step.done`、`step.refused` 等

---

## 7. 临时 Workflow

平台**没有原生的“临时流程”对象**。这个技能用现有生命周期实现：

```
唯一命名的 DRAFT → 激活（拿授权/版本）→ 可选起 Run → 停用 → 删除
```

```bash
node client.mjs temp-save '{
  "name":"TMP-客户拜访-20261117",
  "description":"一次性客户拜访审批",
  "runClassName":"visit_request",
  "runContract": { "...": "..." },
  "steps":[
    {"stepNo":1,"name":"提交","roleCode":"EMPLOYEE","actionId":"act_visit_start","actionType":"execute","scope":"all"},
    {"stepNo":2,"name":"领导审批","roleCode":"DEPT_LEADER","actionId":"act_visit_approve","actionType":"approve","scope":"self_subtree"}
  ]
}'
```

默认保存后立即激活；`--draft` 只存草稿。需要立刻起 Run：

```bash
node client.mjs temp-save tmp.json --run '{"s1":{"title":"拜访A公司"}}'
```

结束后清理：

```bash
node client.mjs temp-clean <workflowId>
```

注意：

- 先跑 `org-graph` 确认目标角色确实具备所需 Action，并确认自己的角色 `canAuthorWorkflow=true`。
- **需要 `/workflow/save` 和 `/workflow/activate` 权限**；普通使用方没有时会失败，明确报缺哪个权限，再让管理员补授权或代建。
- 激活会给 `role × action` 落授权；临时流程也会出现在 `workflow/query`、`grants` 里，直到停用/删除。
- `temp-clean` 先失效（回收该版本授权）再删除；已经创建的 Run 模板是冻结的，账本记录不受影响。
- 这不是“无痕流程”：`Activated` 事件、版本号、Run 记录都会留下。
- 如果只想试跑一次、不想留授权，必须显式 `temp-clean`；否则它就是一条普通的 ACTIVE 流程。

---

## 7.5 临时流程单（Case）

临时流程没有业务事实类，环节间的信息由 Case 承载。Praxis 在 run 创建时自动建 Case，`form_schema` 冻结在模板里。

### 建流程时声明

```json
{
  "name": "TMP-虚机申请",
  "temporary": true,
  "runClassName": "workflow_case",
  "caseFormSchema": {
    "type": "object",
    "required": ["cpu", "memory_mb", "disk_mb", "os"],
    "properties": {
      "cpu": {"type": "integer", "minimum": 1},
      "memory_mb": {"type": "integer", "minimum": 1024},
      "disk_mb": {"type": "integer", "minimum": 10240},
      "os": {"type": "string", "enum": ["centos", "ubuntu", "redhat"]},
      "host": {"type": "string", "minLength": 1},
      "ip": {"type": "string", "minLength": 1}
    }
  },
  "steps": [
    {"stepNo": 1, "name": "提交", "roleCode": "研发人员", "actionId": "act_expense_submit", "actionType": "execute", "caseScoped": true},
    {"stepNo": 2, "name": "办理", "roleCode": "研发人员", "actionId": "act_vm_create", "actionType": "execute", "caseScoped": true,
     "inputBindings": {"cpu": "payload.cpu", "memory_mb": "payload.memory_mb", "disk_mb": "payload.disk_mb", "os": "payload.os"},
     "locked": ["cpu", "memory_mb", "disk_mb", "os"]}
  ]
}
```

- `temporary: true` + `runClassName: "workflow_case"`：不要求业务事实类或 `runContract`。
- `caseScoped: true`：激活时不写 `role × action` 全局授权；执行时只允许 Case 当前 assignee。
- `inputBindings`：Action 参数从 Case payload 取；`locked` 的字段办理人改不了。

### 运行

```bash
node client.mjs temp-save tmp.json --run '{}'
# 返回 runId；发起人写 Case
node client.mjs case-submit <runId> '{"cpu":2,"memory_mb":8192,"disk_mb":204800,"os":"centos"}'
# 办理人补 host/ip
node client.mjs case-fill <runId> '{"host":"dev-02","ip":"10.0.0.12"}'
# 推进（若未自动执行）
node client.mjs tick <runId>
# 结束后结案
node client.mjs case-close <runId>
```

- `case-submit` 只有 requester 能调；`case-fill` 只有 requester 或当前 assignee；`case-close` 只有 requester 或 assignee。
- Case closed 后自然失效，不再需要 `temp-clean` 才回收授权（本身也没有角色级授权）。
- 读 Case：`node client.mjs case <runId>`。

---

## 8. 错误语义（按错误做下一步）

| 返回 | 含义 | 下一步 |
|---|---|---|
| 401 `A platform token is required...` | Praxis 写接口没有 token | 用 `login` 拿 token；检查 `OA_DOMAIN` |
| 403 `The requester is X but the token belongs to Y` | body 身份与 token 不一致 | 不要伪造；用本人账号 |
| 403 `Not eligible to decide` | 不是你这一步 | 看 `inbox`/`candidates`，或让有权限的人来 |
| 403 `notGranted` / `Action.targetOutsideScope` | Ontomato 授权/作用域拒绝 | 找管理员补角色/组织授权 |
| 400 `Missing parameter: X` | Action 参数缺失 | 按 `function.parameters` 补 |
| 400 `preconditions are not met` | 不是你的回合/状态不对 | 查业务对象当前节点/状态 |
| 400 `Step is X, not waiting` | 已决定/已执行 | 查 `run-status`，不要重复决定 |
| 409 `duplicate key` | Trigger 同一槽重复点火 | 视为已点火，去查已有 Run |
| `No published pending-items query` | 流程没有生成待办查询 | 检查 `runContract`/`activationNotes`，让管理员重新激活 |
| `Praxis 连不上` | 账本服务没起 | `pnpm dev:praxis` 或由管理员起；拉式 Action 仍可用 |

---

## 9. 命令速查

| 命令 | 作用 |
|---|---|
| `login / me / ping / praxis-health` | 身份与可达 |
| `org-graph` | 我的组织子树：下级组织、成员、角色、可执行能力 |
| `subjects / roles` | 域内主体/角色 |
| `my-actions` | 我的有效授权动作 |
| `find <需求> [className]` | 语义找动作 + 权限标记 |
| `pending [limit] [--flow id]` | 平台待办查询 |
| `template <workflowId>` | 冻结模板 |
| `run <actionId> <json>` | Ontomato 拉式执行 |
| `start <workflowId> [inputs]` | 创建 Praxis Run |
| `bind <runId> <class> <id>` | 绑定业务对象 |
| `inbox` | Praxis 待办 |
| `decide <stepId> approve\|reject [comment]` | 审批 |
| `assign <stepId> <principal\|--clear>` | 指派 |
| `candidates <stepId>` | 候选人 |
| `runs / run-status / tick` | 账本状态/推进 |
| `temp-save / temp-clean` | 临时流程生命周期 |

写命令支持 `--dry-run`。

---

## 10. 边界

1. **临时 Workflow 不是原生对象**：是 DRAFT→ACTIVE→运行→停用/删除的生命周期；会留版本、授权和事件。
2. **两条待办不自动同步**：`pending`（Ontomato 业务对象）与 `inbox`（Praxis 账本）是两套视图；以业务对象为锚做交叉引用，不要假设数量一致。
3. **不要重复执行**：Praxis Run 里的步骤用 `decide`，不要再用 `run` 调同一个审批 Action。
4. **不能替别人办事**：`requester/decider/assignedBy` 必须与 token 一致。
5. **读接口边界**：Praxis 的 `GET /inbox`、`/runs` 目前不做鉴权（依赖 127.0.0.1 绑定）；不要把 Praxis 暴露到公网。
6. **目录退化**：`degraded=true` 是“没有账户目录”，不是“角色没人”。
7. **跨源不能 JOIN**：业务对象与账本必须两步查。
8. **审批 Action 的 `run_id` 是业务对象 id**：没绑定 `actsOn` 且输入没有 `run_id` 时，字段会被省略，审批动作可能失败。
9. **驳回也会执行 Action**：业务对象必须能处理 rejected 分支。
10. **没有原生双人复核**：`twoKeys` 只编译成普通 human 步。

---

## 11. 安全

- 不要把密码/token 写进文件或对话；用环境变量。
- 建临时流程、停用/删除前先确认；这些是真实域数据。
- 不要为了“跑通”用管理员账号伪造业务角色；审批记录会留下主体。
