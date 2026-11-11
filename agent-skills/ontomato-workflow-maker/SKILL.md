---
name: ontomato-workflow-maker
description: 在 Ontomato 上从零创建一条业务流程：把业务描述拆成「运行对象 + 运行契约 + 角色 + 每步动作」，建角色、写 Action（声明目标对象和单据状态前置条件）、声明 runContract（单号/节点/状态/负责人的字段位置）、存流程草稿、经有审批权的账号激活落授权，激活同时自动生成「我的待办」「单据详情」两个查询，再以各角色身份完整走一遍。用于「我要在 ontomato 里做一个 XX 业务流程」「建 workflow/action/role」「把这条流程跑通」这类任务。
---

# 从零创建一条业务流程（Workflow + Action + Role）

这个技能解决一件事：**用户用一句话描述业务流程，你在平台上把它建成可运行的流程，然后带着人走一遍。**

平台里没有流程引擎。一条流程能不能跑通，靠的是三样东西同时成立：

| 要素 | 作用 | 不是 |
| --- | --- | --- |
| `Workflow` + 步骤 | **授权的发布单元**：激活时把这几个"角色×动作"的授权一起落库 | 不是运行时 |
| 步骤里的 `Action` | 真正干活的那段 python；谁能跑、什么时候能跑都写在它自己身上 | 不是流程节点 |
| 步骤里的 `roleCode` | 授权主体：激活时解析成域内角色 | 不是人名 |

因此流程的"流转"是**主体拉式**的：轮到谁，谁自己来跑他那一步的动作；步骤授权的范围决定谁可以办这张单，动作的 `submissionCriteria` 检查当前步骤和单据状态。不要去找"下一步该派给谁"的接口，它不存在，也不该存在。

## 身份与工具

- 客户端：`node <SKILL目录>/wf-client.mjs <子命令>`
- 环境变量：`WF_BASE`（默认 `http://localhost:8080/api/data-query`）、`WF_AUTH`、`WF_DOMAIN`（必填）、`WF_CODE`/`WF_PASS`
- 域管理员账号密码由用户提供，不要在对话里复述；客户端只在内存里用一次。
- 平台两套响应外壳（`{success,message}` 与 `{success,code,data}`）客户端已统一处理。

## 第 0 步：确认环境活着，别在死栈上建东西

```bash
export WF_DOMAIN=<域id>
node wf-client.mjs login <loginCode> <password> <domainId>
node wf-client.mjs ping        # workflow 接口是否可达
node wf-client.mjs me          # 当前账号与域
```

`ping` 连不上（ECONNREFUSED / 302）就停止：这不是本技能能修的，告诉用户开发栈没起，并给出确切的启动方式（企业版仓根目录 `pnpm dev:up`，或 `node ../ontomato/scripts/dev-stack.mjs . up`）。**没验证过登录就不要开始设计流程**——后面每一步写操作都会撞在同一个错上。

## 第 1 步：把业务描述拆成六个决定

用户说的话要落成这五项。缺哪项就问，不要替他默认。

1. **运行对象**：这条流程的每一次"走一遍"是什么东西？一条报销单、一次开虚机申请、一份验收单。
   → 一个事实层类（如 `expense_request`）+ 主键 + 业务属性。
2. **步骤序列**：谁先、谁后、每步是审批还是执行。
3. **每步的角色**：用域里已有的角色名（`roleName`），流程步骤的 `roleCode` 就是它。
4. **授权范围**：全部可读对象、所在组织、所在组织及下级、仅下级、本人发起或指派给本人。选组织范围时确定业务单据存组织编码的字段。
5. **提交要件**：用户提交这张单必须填什么；哪些字段由平台算、不许调用方传。
6. **运行契约**：这张单的「身份 / 当前节点 / 状态 / 负责人」分别存在哪几个字段？状态里哪些值算「还没办完」？
   → 落地为 `runContract`；激活时逐字段校验，也是「我的待办」查询能自动生成的前提。

先看现状再设计：

```bash
node wf-client.mjs roles          # roleName 就是可用的 roleCode
node wf-client.mjs subjects       # 域内主体及其有效角色 —— 判断"这步有没有人能做"
node wf-client.mjs actions        # 已有哪些动作，避免重名/重建
```

**只到角色为止。** 业务流程设计不建主体：主体挂角色是日常运维的事，不属于这条流程的建模范围。`subjects` 只用来检查"某角色当前有没有人"，没有人在走流程时会卡住 —— 那时提示用户去维护成员，而不是自己造用户。

## 第 2 步：补齐缺失的角色

```bash
node wf-client.mjs role-save '{"roleName":"DEPT_LEADER","roleDesc":"部门领导，审批本部门申请"}'
# → {"roleId":"..."}
```

- `roleName` 是业务词汇、≤50 字符；新建时 `roleType` 会被强制置 0（普通角色），**不要试图建管理角色**。
- `roleDesc` ≤200 字符。服务端直接调 `roleDesc.length()`，**缺字段会 NPE**，客户端会自动补一个默认值并提示。
- 角色名唯一，域内重名会报 `Role [x] already exists!`。
- 步骤里的 `roleCode` 在**激活时**才解析成角色 id。名字写错不会在保存时报错，会在激活时报 `The workflow names a role that does not exist in this domain: X` —— 所以先 `roles` 对一遍。

给角色挂人（**只有用户明确要求时**）：

```bash
node wf-client.mjs role-members <roleId>                    # 只读：列出当前成员
node wf-client.mjs role-members <roleId> U001,U002          # 合并：保留现有成员再加这两人
```

⚠️ 底层的 `addRoleUserRlt` 是 **replace 语义，不是 add**：提交什么集合，角色成员就变成什么集合。客户端已按"读全 → 取并集 → 提交"实现，但仍要先确认这次加人是否会把谁踢掉（比如管理角色的成员是自动全量成员，不要拿它做实验）。

## 第 3 步：确认运行对象的类存在

```bash
node wf-client.mjs dsl '{"problem":"查类是否存在","answer":{"steps":[{"graph":{"patterns":[{"objects":[{"idx":0,"variable":"c","class":"<类名>"}]}],"pattern_logic":"and"},"output":{"to_user":true,"fields":[{"as":"id","variable":"c","field":"<主键>"}],"limit":{"offset":0,"count":1}}}]}}'
```

- 类已存在 → 记下主键名与属性，第 4 步的 python 按它的真实字段写。
- 类不存在 → **停下来告诉用户**，不要自己建。原因：`POST /admin/addClass` 只把类写进 ontomap（语义层），**不创建物理表**；`insert` 也不会自动建表。类建了但表不存在，动作一跑就报"表不存在"。物理表要么由数据源侧已有，要么走导入/建表流程 —— 这一步属于建模，不是建流程。
- `runClassName` 不只是登记：它是 `workflowRunId` 能否进身份快照的判据。程序里要读 `identity.workflowRunId` 时，平台要求「该域内恰好一条生效流程同时声明这个 run 类、且把当前动作列为步骤」，否则这个字段不出现。所以**要认真填对类名**。
- 验证一下它是否真的会生效（可选）：跑一次办理动作后，看程序拿到的 `identity.json` 里有没有 `workflowRunId`。

## 第 3.5 步：声明运行契约（runContract）

`runContract` 告诉平台从哪里读一张单的生命周期。它是**投影，不是 schema**：不限制你的类长什么样，只要求能说清四件事。

随 `wf-save` 一起提交（和 `steps` 同级）：

```json
"runContract": {
  "className": "vm_request",
  "idField": "id",
  "stepField": "current_node",
  "statusField": "status",
  "statusOpen": ["待办"],
  "statusDone": ["已完成"],
  "statusRejected": ["已驳回"],
  "assigneeField": "assignee_id",
  "orgField": "department_code",
  "initiatorField": "applicant_id"
}
```

- `idField` 可省，默认 `id`；`stepField` / `statusField` 必填；`statusOpen` 至少一个值。
- 三组状态**不能重叠**（一个值既「开放」又「完成」，读的人无法判断）。
- 每个声明的字段都会对照类的 `classDef` 校验；拼错会在保存/激活时报 `<类> 没有该属性`，而不是运行时静默查不到。
- `className` 与旧的 `runClassName` 必须一致；只填一个时，另一个会自动补齐。

**不声明也能跑**，但不会有自动生成的查询；而且「我的待办」只能靠 agent 现写 DSL —— 那正是这个契约要消灭的失败模式。

## 第 4 步：为每一步写一个 Action

流程有 N 步，就写 N+1 个动作：**1 个发起动作 + 每步 1 个办理动作**。

### 4.1 动作骨架（导入格式）

```json
{
  "id": "act_<流程>_<步骤>",
  "name": "中文动作名",
  "description": "一句话说清这个动作做什么",
  "origin": "USER",
  "status": "PUBLISHED",
  "submissionCriteria": { "conditions": [ ... ] },
  "function": {
    "id": "fun_<流程>_<步骤>",
    "name": "同动作名",
    "origin": "USER",
    "operation": "OPERATION_WRITE",
    "description": "程序做什么",
    "parameters": [
      {"name": "run_id", "type": "TYPE_STRING", "description": "运行对象主键", "sample": "X001", "classNames": ["<类名>"]}
    ],
    "returnDef": {"isVoid": true, "classNames": ["<类名>"]},
    "code": "# ontomato-python:2\n...",
    "logic": "人话版逻辑，供解释与审阅"
  }
}
```

硬约束（都是代码里真的会拒的）：

| 约束 | 出处行为 |
| --- | --- |
| `code` 第一行必须是 `# ontomato-python:2` | 运行时版本标记 |
| `function.operation` 只能是 `OPERATION_WRITE` | 保存时强制，否则 `Function.notWrite` |
| `status` 用 `PUBLISHED` 才算可执行 | `DRAFT` 下执行报 `Action.notPublished` |
| 已发布就**冻结** | `PUBLISHED` 后改 `code` 报 `Action.publishedIsFrozen`；要改就新建动作 |
| 每个动作必须有内嵌 `function` | 导入报 `has no embedded function` |
| 参数类型目前用 `TYPE_STRING` | 其余类型在本部署未验证 |

### 4.2 发起动作的代码

```python
# ontomato-python:2
import uuid
from datetime import datetime
from query_runtime import parameters as params, insert

def run():
    run_id = str(uuid.uuid4())
    insert("<类名>", [{
        "id": run_id,
        "title": params.get("title"),
        "applicant_id": params.get("applicant_id"),
        "current_node": "<第一步名称>",
        "assignee_id": params.get("assignee_id"),
        "status": "待办",
        "started_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }])
    return {"run_id": run_id, "current_node": "<第一步名称>"}

result = run()
```

`query_runtime` 可用的写原语：`insert / update / delete / createEdge / deleteEdge / appendVector / updateVector / deleteVector`，读用 `query(dsl)` 或 `execute_dsl(dsl)`。参数从 `parameters as params` 取。

### 4.3 办理动作：声明目标与单据状态

对已有对象执行的 Action 在顶层声明 `"target":{"className":"expense_request","keyParameter":"run_id"}`；`run_id` 必须是 Function 的字符串参数。创建单据时不声明尚未存在的目标，只能授予 all。以下条件只检查单据状态，人员和组织归属写在步骤 scope 上。

```json
"submissionCriteria": {
  "conditions": [
    {"objectParameter": "run_id", "className": "<类名>", "field": "current_node",
     "operator": "=", "value": "<本步名称>", "message": "这一步还没轮到"},
    {"objectParameter": "run_id", "className": "<类名>", "field": "status",
     "operator": "=", "value": "待办", "message": "这张单当前不是待办状态"}
  ]
}
```

规则（都来自 `ActionPreconditionService` 的实际行为）：

- `objectParameter` 指向**参数名**，用它的值去定位对象；参数没传 → 条件不成立 → 拒绝。
- 条件不能比较当前用户；“指派给本人”用 `assigned_to_self`，字段来自运行契约的 `assigneeField`。
- 条件无法求值（类名写错、对象读不到）→ **拒绝**。
- 支持的 `operator`：`= / != / > / >= / < / <= / in / not in / like / is / is not`。NULL 走三值逻辑，`is` 判空。
- 前置条件读状态走的是**带数据权限的**查询，不是绕过权限直读。

办理动作的代码负责三件事：更新本对象当前状态、推进到下一步（或结束）、必要时写日志。

```python
# ontomato-python:2
from datetime import datetime
from query_runtime import parameters as params, update, insert

def run():
    run_id = params.get("run_id")
    result = params.get("result")          # approved / rejected / done
    comment = params.get("comment") or ""
    update("<类名>", {
        "current_node": "<下一步名称，或 结束>",
        "status": "已完成" if result in ("approved", "done") else "已驳回",
        "assignee_id": "<下一步负责人来源，或 空>",
        "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }, {"id": run_id})
    insert("<日志类名>", [{ "id": ..., "run_id": run_id, "operator_id": params.get("operator_id"), "result": result, "comment": comment }])
    return {"run_id": run_id, "result": result}

result = run()
```

只有“指派给本人”的步骤需要写入具体负责人。部门步骤用单据组织编码和角色的授权范围，不按成员列表猜一个审批人。

另外：`operator_id` 现在是**冗余**的 —— 身份快照已经有服务端算好的身份，不要再靠参数传。

程序里直接读（`query_runtime` 已注入）：

```python
from query_runtime import identity, parameters

principal_id = identity.get("principalId")      # 服务端认定的执行人
workflow_run_id = identity.get("workflowRunId")  # 仅有唯一归属时才有这个键
```

快照还包含 `organizations: [{id, code, name}]` 与 `positions: [{id, name, orgId}]`。组织编码由平台在新建时生成；改名、移动不改变它，管理员可换成客户系统使用的编码。业务数据的组织字段存 **code**，不存名称或平台内部 id。

创建单据的 Action 从 `query_runtime.identity["organizations"]` 取本次所属组织的 `code` 写入单据。执行人属于多个组织时，按这次业务选择对应组织，不默认取第一项；选组织是填写业务事实，不代替平台授权。

快照内容：`principalId / domainId / loginCode / userName / membershipId / roles[]`，外加满足条件时的 `workflowRunId`。

**关键约束（必须理解，否则会误用）：**

| 事实 | 含义 |
| --- | --- |
| 由服务端写入 `identity.json` | 调用方无法伪造；`inputFiles` 里传同名文件会被拒 |
| **不参与授权判定** | 能不能读写仍 100% 由 `ONTOMATO_TK` 决定；快照只供业务判断 |
| `workflowRunId` 需要**声明目标、读到该行且仅一个生效流程拥有它** | 参数里的 id 只是线索，通过目标点查后才用于流程归属 |
| `workflowRunId` 需要**归属唯一** | 多条生效流程都含此动作 → 不给值（宁可没有，不给错的） |

所以：**做业务判断读快照，业务授权由平台按角色、范围和目标可读性判断。** 不要因为「能读到 principalId」就以为可以跳过 `submissionCriteria`——那是两回事。

### 4.4 导入

```bash
node wf-client.mjs action-import ./actions.json      # 数组或单对象
```

客户端会自己打成 zip（导入接口要 zip，内部恰好一个 `.json`），并带 `allowMissingExplanation=true`。

预期返回 `{"success":true,"successCount":N,"failureCount":0,"failures":[]}`。
`success:false` 或 `failureCount>0` 就逐条读 `failures[].message`，不要重试同一条 —— 都是确定性的校验失败。

导入后抽查：

```bash
node wf-client.mjs action-get act_xxx     # 看 status=PUBLISHED、parameters、submissionCriteria
```

## 第 5 步：存流程草稿

```json
{
  "name": "日常报销审批",
  "description": "员工报销，部门领导审批后财务打款。",
  "runClassName": "expense_request",
  "runContract": {"className":"expense_request","idField":"id","stepField":"current_node","statusField":"status","statusOpen":["待办"],"orgField":"department_code","assigneeField":"assignee_id"},
  "steps": [
    {"stepNo": 1, "name": "领导审批", "roleCode": "DEPT_LEADER",
     "actionId": "act_expense_approve", "actionType": "approve",
     "scope": "self_organization", "description": "审批必要性与金额"}
  ]
}
```

```bash
node wf-client.mjs wf-save ./workflow.json
# → {"id":"...","status":"DRAFT","version":0}
```

- `stepNo` 从 1 连续递增；`actionType` ∈ `approve|execute`；`scope` ∈ `all|self_organization|self_subtree|self_descendants|initiated_by_self|assigned_to_self`。
- `roleCode` 与 `actionId` 都不能空；`actionId` 必须能在本域查到动作。
- 保存后是 `DRAFT`，**不授予任何权限**。

## 第 6 步：审批 → 激活

激活就是这条流程的**审批时刻**：冻结当前步骤为编号版本、把每个"角色×动作"的授权写进 `sys_role_capability`、追加一条 `Activated` 事件（记录审批主体）。

谁能批：域里持有管理角色（`roleType=1`，拦截器放行全部已启用 API）或持有 `action-management` 对应 API 权限的角色。先用现状确认，不要猜：

```bash
node wf-client.mjs wf-access     # 每个角色能用的平台操作；managementRole=true 即管理角色
```

**用有审批权的账号登录**（不是发起人、不是某一步的执行人）再激活：

```bash
node wf-client.mjs wf-activate <workflowId>
# → {"id":"...","status":"ACTIVE","version":1}
```

失败时最常见的两条：
- `The workflow names a role that does not exist in this domain: X` → 回第 2 步建角色。
- `step N names an unknown action: Y` → 动作没导入成功或 id 拼错。

激活后立刻核对授权真的落地了：

```bash
node wf-client.mjs wf-grants       # 应出现 N 行：roleCode × actionId × activatedByWorkflowVersion=1
```

`wf-grants` 里没有对应行 = 这个动作谁都跑不了（除了例外，见下）。

### 激活还会生成两个查询

声明了 `runContract` 的流程，激活时会按契约生成两个**已发布**的 MetricView：

| 名称 | 口径 | 谁用 |
|---|---|---|
| `我的待办 · <流程名>` | 开放状态，且当前冻结步骤属于本人的有效角色、单据在该步骤的授权范围内；仍受读侧行权限约束 | 各角色本人问「我有什么待办」 |
| `单据详情 · <流程名>` | 按 `idField` 查，调用方传 `runId` | 「这张单到哪一步了」 |

激活响应里的 `activationNotes` 是**生成告警**：为空表示两个查询都生成了；有内容说明某个没生成。**不要把它当成普通成功忽略掉** —— 没有已发布待办查询时，`pending` 会明确报错，不会解释为没有待办。升级不会补发旧指标；下次重新发布流程才生成带来源的查询。

核对：

```bash
node wf-client.mjs wf-query <workflowId>     # 看 runContract 回显与 activationNotes
# 生成的 metric 可在本体服务的「指标视图」页看到，状态应为 PUBLISHED
```

待办按流程 ID、冻结版本及用途识别，不能按名称认领旧指标。组织步骤不要求负责人；个人指派才使用 `assigneeField`。步骤名称必须唯一，与单据的当前步骤值完全相同。多个流程共用运行类时，声明 `workflowRefField` 并让创建单据的 Action 将流程 ID 写入该字段。agent 的 `pending` 只执行已发布的待办指标，查不到指标和没有待办是两种不同的结果。


## 第 7 步：以各角色身份完整走一遍

### 7.1 先算清楚"每步由谁来做"

```bash
node wf-client.mjs subjects
```

对每个步骤，找持有该 `roleCode` 的成员，得出 `步骤 → 账号`。三种情况：

| 情况 | 处理 |
| --- | --- |
| 该角色恰好一个成员 | 直接用他 |
| 多个成员 | 按单据字段与步骤的授权范围选择验收账号；同一角色可用不同部门的成员验证允许和拒绝 |
| 一个成员都没有 | **停**。这一步没有合法执行人，流程一定走到这里死掉；让用户先维护成员 |

### 7.2 每个身份都要能真的执行

授权只认"这个账号的有效角色里，有角色被授了这个动作"。**域管理员不特殊处理**：管平台 ≠ 能跑业务动作。所以：

- 有各角色账号的凭证 → 每个身份单独登录（`WF_CODE`/`WF_PASS` 或 `login` 子命令）后执行。
- 只有管理员一个账号 → 必须让管理员**临时加入**每一步的角色（`role-members <roleId> <userId>`，内部按并集提交），走完再恢复。这改的是域数据，**先跟用户确认**再动。

不要用同一个令牌伪造 `operator_id` 假装不同角色 —— 授权是按令牌背后的账号算的，`operator_id` 只影响写进日志的名字。这样"走通"是假的。

### 7.3 走的顺序

```bash
# 1) 发起人
node wf-client.mjs run act_<流程>_start '{"title":"10月客户拜访","applicant_id":"<发起人>","assignee_id":"<第一步负责人>"}'
# → {"run_id":"...","current_node":"领导审批"}

# 2) 逐步推进，用该步负责人的身份
node wf-client.mjs run act_<流程>_approve '{"run_id":"<run_id>","operator_id":"<该步操作人>","result":"approved","comment":"同意"}'
```

每步之后核对两件事：返回的 `current_node` 是否前进到下一步；用查询确认对象状态真的变了。

```bash
node wf-client.mjs dsl '{"problem":"查运行对象","answer":{"steps":[{"graph":{"patterns":[{"objects":[{"idx":0,"variable":"r","class":"<类名>","conditions":{"properties":{"field":"id","operator":"=","value":"<run_id>"}}}]}],"pattern_logic":"and"},"output":{"to_user":true,"fields":[{"as":"id","variable":"r","field":"id"},{"as":"node","variable":"r","field":"current_node"},{"as":"status","variable":"r","field":"status"},{"as":"assignee","variable":"r","field":"assignee_id"}],"limit":{"offset":0,"count":10}}}]}}'
```

### 7.4 反面用例也要走一次（这才是"验证过"）

同一轮里必须证明**拦住**了，否则只证明了顺风路径：

- **不是你的回合**：拿上一步的动作再跑一次，应报前置条件不满足、文案是你写的 `message`。
- **无授权**：拿一个不持有该步角色的账号跑该动作，应报 `notGranted`（未授权）。
- **驳回路径**：任一步 `result":"rejected"`，状态应变 `已驳回` 且不再前进。

三条都拿到确切返回，才可以说这条流程跑通了。

## 完成判据

- `wf-query <id>`：`status=ACTIVE`、`version>=1`、`steps` 与设计一致（角色、动作、类型、派单规则）；`runContract` 回显且字段正确；`activationNotes` 为空。
- 生成的 `我的待办` / `单据详情` 两个 metric 存在且为 `PUBLISHED`；用一个真实待办执行 `我的待办`，只返回该角色的单。
- `wf-grants`：每个步骤一行授权，`activatedByWorkflowVersion` 与流程版本一致。
- 顺风路径：从发起到最后一步完成，运行对象的 `current_node`/`status` 逐步变化可查。
- 反面路径：非本回合、无授权、驳回三条都有确切拒绝返回。
- 向用户复述：流程名/版本、每步的「角色 → 动作 → 派单规则 → 实际由谁做」，以及哪几条是模拟执行（没有真的开虚机/打款）。

## 常见错误

| 报错 | 原因 |
| --- | --- |
| `Action is outside the current domain` | 令牌的域与动作的域不一致 |
| `Action.notPublished` | 动作还不是 `PUBLISHED` |
| `Action.notGranted` | 令牌账号的有效角色里没有被授这个动作 |
| `Action.publishedIsFrozen` | 想改已发布动作的代码；新建动作代替 |
| `Precondition failed: ...` 或你的 `message` | 单据业务条件不满足（阶段或状态） |
| `Function.notWrite` | `operation` 不是 `OPERATION_WRITE` |
| workflow save `ClassCastException`（旧版本） | 已修复；若仍出现，说明后端不是当前分支 |

## 不要做的事

- 不要建主体/用户来"凑人"。流程设计只到角色。
- 不要为物理表不存在的类硬写动作；先解决建模。
- 不要用 `addRoleUserRlt` 追加成员（它 replace）。
- 不要重复 `activate` 同一份未改的步骤来"再试一次"：每次都会 `version+1` 并重发一遍授权行（重复激活的幂等性本迭代未做）。
- 不要删生效中的流程（删不掉，且撤权必须先失效留记录）；要换版本就改草稿再激活。
- 不要把"只跑了第一步"说成"流程闭环"。
