---
name: ontomato-process-admin
description: 以域管理员身份在 Ontomato 上把公司业务流程固化下来：组织架构、成员、岗位、角色与角色的 API/菜单/数据权限、组织授权、Action、Workflow 与 runContract、Trigger、激活授权和可用性验收。用于「建组织/角色/权限」「把这条公司流程固化」「发布流程并授权」「新建触发器」这类任务。
---

# Ontomato 固定业务流程管理

这个技能只做一件事：**把一条公司流程定义成可发布、可授权的固定流程，并证明它真的能跑。**

它不负责发起一次运行，也不负责日常审批；那是 `ontomato-process-operator` 的事。

平台里没有“流程引擎”。一条流程能不能跑通，靠的是四样东西同时成立：

| 要素 | 作用 | 不是 |
| --- | --- | --- |
| `Workflow` + 步骤 | **授权的发布单元**：激活时把“角色×动作”的授权一起落库 | 不是运行时 |
| 步骤里的 `Action` | 真正干活的 Python；谁能跑、什么时候能跑写在它自己身上 | 不是流程节点 |
| 步骤里的 `roleCode` | 授权主体：激活时解析成域内角色 | 不是人名 |
| `runContract` | 业务运行对象上的字段投影：单号/节点/状态/负责人 | 不是表结构 |

运行时的“流转”是**主体拉式**的：轮到谁，谁自己来跑他那一步的动作；动作的 `submissionCriteria` 判定“现在是不是你的回合”。不要去找“下一步该派给谁”的接口，它不存在。

---

## 0. 模型：角色、岗位、权限、组织授权

这是本技能最容易做错的部分，先对齐代码事实。

```
组织单位（sys_org_unit，一棵树，一个根）
  ├── 成员（sys_org_membership：userId ↔ orgId，可 locked）
  ├── 岗位（sys_org_position：属于某个 org，有 assigneeIds）
  └── 组织授权（sys_org_role_grant）
        recipient = organization | subtree | position
        roles     = 这些角色
        scopes    = 共享哪些组织数据

角色（sys_role）
  ├── 成员（sys_role_user_rlt）
  └── 岗位（sys_role_post_rlt）

岗位（sys_post）
  ├── API 权限（sys_post_api_rlt）
  ├── 菜单权限（sys_post_menu_rlt）
  └── 数据权限（sys_data_permission：行/字段）
```

要点：

- **角色不直接持有 API/菜单权限**。角色持有岗位，岗位持有权限；用户通过“有效角色 → 岗位 → 权限”获得能力。
- **组织授权是“把角色授予某个组织范围”**，不是把权限授予人。它决定谁在哪些组织里“有效持有”这些角色。
- **岗位有两种**：`postType=1` 是 API/菜单管理岗，`postType=2` 是数据岗（`fullData=1` 表示全部数据权限）。域创建时平台会建一个管理员 API 岗和一个全量数据岗。
- **角色 `roleType`**：`1` 是管理角色（域创建时的 `admin`），普通业务角色用 `0`。不要随手建管理角色。
- **一个域只有一棵组织树**（`Each domain can maintain only one organization tree!`），第一个单位是根，其余必须挂在根下面。
- **单位 `code` 缺省时由平台生成 `org-<uuid>`**；`unit/save` 会忽略传入的 `code`（实测），不要依赖自造 code。

---

## 1. 前置条件

- 开发栈已起：企业版仓根 `pnpm dev:up`（或生产部署），`GET /health` 成功。
- 你有一个**域管理员**账号（能写组织、角色、Action、Workflow）。
- 本技能目录可单独拷走；`client.mjs` 只用 Node 内置模块。
- 平台入口默认 `http://localhost:8080/api/data-query`；登录默认 `http://localhost:8080/api/auth`。

## 认证（三选一，没有默认账号）

客户端支持三种认证方式：

1. **平台 token**：`ONTOMATO_TK`（兼容 `OA_TOKEN`，`OA_TOKEN` 显式设置时优先）；
   或 `node client.mjs login --token ***
2. **Ontomato API Key**：`ONTOMATO_API_KEY`（兼容 `OA_API_KEY`）；
   或 `node client.mjs login --api-key ***
   管理员可以用 `node client.mjs user-apikey <userId>` 生成（明文只返回一次）。
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
# 平台 token（推荐）
export ONTOMATO_ONTOLOGY_URL=http://localhost:8080/api/data-query
export ONTOMATO_TK=<平台 token>

# 或用户名+密码
# export OA_DOMAIN=<域id>
# export OA_CODE=<管理员登录名>
# export OA_PASS=<密码>
```

---

## 2. 阶段 0：确认环境活着

```bash
node client.mjs login
node client.mjs ping
node client.mjs me
node client.mjs subjects
```

`ping` 连不上就停：这是环境问题，不是流程定义问题。

---

## 3. 阶段 1：组织架构、成员、岗位、角色

### 3.1 先看现状

```bash
node client.mjs org-tree        # 单位/岗位/成员/组织授权快照
node client.mjs roles           # roleName 就是流程步骤的 roleCode
node client.mjs subjects        # 域内主体及其有效角色
node client.mjs posts           # 岗位
node client.mjs api-list        # 全部 API 权限项
node client.mjs menu-list       # 全部菜单权限项
```

### 3.2 建组织单位

```bash
# 根单位：parentId 省略或为空
node client.mjs org-unit-save '{"name":"总公司","description":"根组织"}'

# 子单位
node client.mjs org-unit-save '{"parentId":"<根id>","name":"研发部"}'
```

- 一个域只能有一个根；第二个 `parentId` 为空的单位会被拒绝。
- `code` 可以不传，平台生成；不要试图用它做业务主键。
- 删除单位会被拒绝，如果它还有子单位、岗位、组织授权或被授权共享。先清子项。

### 3.3 加成员

```bash
node client.mjs member-save <userId> <orgId>
node client.mjs member-remove <userId> <orgId>
node client.mjs member-lock <userId> <orgId> true|false
```

成员是“账号 ↔ 组织”的关系；锁定后不能移除，先解锁。一个账号可以在多个组织，但每个域只有一棵树。

### 3.4 建岗位（可选，但角色权限要靠它）

```bash
node client.mjs post-save '{
  "postName":"研发部业务岗",
  "postType":2,
  "fullData":0,
  "postDesc":"研发部业务数据权限"
}'
```

- `postType=1`：API/菜单管理岗；`postType=2`：数据岗。
- `fullData=1`：全部数据权限；否则用数据权限项逐类配置。
- 岗位建好后，才能给角色挂岗位、给岗位配权限。

### 3.5 建/改角色

```bash
node client.mjs role-save '{"roleName":"DEPT_LEADER","roleDesc":"部门领导，审批本部门申请"}'
```

- `roleName` 是业务词汇，也是流程步骤的 `roleCode`；域内唯一。
- 普通角色 `roleType=0`；不要建 `roleType=1` 的管理角色，除非你确实在配平台管理员。
- `roleDesc` 缺省时客户端会补一个默认值（服务端直接调 `roleDesc.length()`，缺字段会 NPE）。

### 3.6 角色挂人、挂岗位

```bash
# 看/合并成员（客户端内部读当前集合再取并集；底层 replace 语义）
node client.mjs role-members <roleId>
node client.mjs role-members <roleId> <userId1,userId2>

# 看/合并岗位
node client.mjs role-posts <roleId>
node client.mjs role-posts <roleId> <postId1,postId2>
```

⚠️ 底层 `addRoleUserRlt` / `addRolePostRlt` 都是 **replace 语义**：提交什么集合，关系就变成什么集合。客户端已经做了“读全 → 取并集 → 提交”，但手工调接口时不要漏掉现有成员。

### 3.7 配岗位权限

```bash
# 看/替换岗位 API 权限
node client.mjs post-api <postId>
node client.mjs post-api <postId> <apiId1,apiId2>

# 看/替换岗位菜单权限
node client.mjs post-menu <postId>
node client.mjs post-menu <postId> <menuId1,menuId2>

# 数据权限：dataType 1=行，2=字段
node client.mjs post-data <postId>
node client.mjs data-permission-save '{
  "postId":"<postId>",
  "dataType":1,
  "className":"leave_request",
  "permission":"{\"field\":\"dept\",\"operator\":\"=\",\"value\":\"$subject.org\"}"
}'
node client.mjs data-permission-delete <dataPermissionId>
```

- `api-list` 里每一项的 `id` 是 `post-api` 要的 ID；`permission` 是接口路径/标识。
- `menu-list` 同理；菜单权限决定侧栏可见项。
- 数据权限的 `permission` 是**字符串化的 JSON**：行权限是 DSL 条件；字段权限是 `{"字段名":0|1|2}`（0 不可见 / 1 可见 / 2 仅分组）。
- 修改是替换语义：先 `post-api <postId>` 读出全部，再提交完整集合。

### 3.8 组织授权（把角色授予组织范围）

```bash
node client.mjs grant-save '{
  "recipient": { "grantType": "subtree", "sourceId": "<研发部orgId>" },
  "roleIds": ["<DEPT_LEADER roleId>"],
  "scopes": [
    { "scopeType": "self_subtree" }
  ]
}'
```

`grantType`（授予谁）：

| 值 | 含义 |
|---|---|
| `organization` | 该组织的成员 |
| `subtree` | 该组织及其下级的成员 |
| `position` | 该岗位的持有人 |

`scopeType`（共享哪些数据）：

| 值 | 含义 |
|---|---|
| `organization` | 指定组织 `targetId` 的数据 |
| `subtree` | 指定组织 `targetId` 及其下级 |
| `position` | 指定岗位 `targetId` 所在组织的数据 |
| `member` | 指定组织 `targetId` 里的某个成员 `userId` |
| `self_descendants` | 每个 recipient 自己的基组织之下（不含基组织） |
| `self_subtree` | 每个 recipient 自己的基组织及其下级 |
| `self_organization` | 每个 recipient 自己的基组织（不含下级） |

- `self_*` 不填 `targetId/userId`，按每个 recipient 自己的基组织解析。
- `original` 用于编辑已有授权：`{grantType,sourceId}`；新建时不填。
- 删除：`node client.mjs grant-delete '{"grantType":"subtree","sourceId":"<orgId>"}'`。
- 组织授权改的是“谁在哪些组织里有效持有角色”，不是直接给权限。

### 3.9 最小可用组织示例

```bash
# 1) 根 + 部门
node client.mjs org-unit-save '{"name":"总公司"}'
node client.mjs org-unit-save '{"parentId":"<root>","name":"研发部"}'

# 2) 部门成员
node client.mjs member-save <rnd1UserId> <研发部>

# 3) 业务角色
node client.mjs role-save '{"roleName":"DEPARTMENT_EMPLOYEE","roleDesc":"部门员工"}'
node client.mjs role-members <employeeRoleId> <rnd1UserId>

# 4) 部门领导：通过组织授权在“研发部子树”有效
node client.mjs role-save '{"roleName":"DEPT_LEADER","roleDesc":"部门领导"}'
node client.mjs grant-save '{
  "recipient":{"grantType":"subtree","sourceId":"<研发部>"},
  "roleIds":["<DEPT_LEADER>"],
  "scopes":[{"scopeType":"self_subtree"}]
}'
```

> 如果只有管理员一个账号，验收时可以把管理员**临时**加入每一步的角色（`role-members`），走完再恢复；这会改域数据，先确认。

---

## 4. 阶段 2：Action（真正干活的写操作）

流程有 N 步，就写 N+1 个动作：**1 个发起动作 + 每步 1 个办理动作**。

动作导入格式、Python 协议头、参数规则，沿用 `ontomato-workflow-maker` 的约定。本技能只强调与固定流程相关的硬约束：

- `code` 第一行必须是 `# ontomato-python:2`。
- `function.operation` 只能是 `OPERATION_WRITE`。
- `status=PUBLISHED` 才可执行；`PUBLISHED` 后代码冻结，要改就新建动作。
- 每个动作必须内嵌 `function`。
- 参数类型目前用 `TYPE_STRING`。
- 审批动作必须接受 `run_id`（业务对象 id）、`decision`（approved/rejected）、`comment`，并回写业务状态/当前节点/审批人。
- `submissionCriteria` 是“现在是不是你的回合”的判定：状态、当前节点、负责人等。
- `approvalMode`：`auto | human | twoKeys`。`twoKeys` 目前**没有双人实现**，只被编译成普通 human 步。

命令：

```bash
node client.mjs actions
node client.mjs action-get <actionId>
node client.mjs action-import @actions.json
node client.mjs action-reexplain '{"ids":["act_..."]}'
```

导入是草稿/待审核；`action-reexplain` 生成解释后，再用 `action-get` 核对 `status=PUBLISHED`。

---

## 5. 阶段 3：Workflow（固定流程）

### 5.1 先定六个决定

1. **运行对象**：每次走一遍是什么？（如 `leave_request`）→ 事实层类 + 主键 + 业务属性。
2. **runContract**：单号/当前节点/状态/负责人在类上的字段位置。
3. **步骤序列**：谁先、谁后；每步是审批还是执行。
4. **每步角色**：用域里已有的 `roleName`；步骤的 `roleCode` 就是它。
5. **派单规则**：`all` / `self_organization` / `self_subtree` / `self_descendants` / `initiated_by_self` / `assigned_to_self`。
6. **提交要件**：发起时必填什么；哪些字段由平台算、不许调用方传。

### 5.2 runContract

```json
{
  "className": "leave_request",
  "idField": "id",
  "stepField": "current_node",
  "statusField": "status",
  "statusOpen": ["待办"],
  "statusDone": ["已完成"],
  "statusRejected": ["已驳回"],
  "assigneeField": "assignee_id",
  "orgField": "dept",
  "initiatorField": "applicant_id",
  "candidateField": "candidate_ids",
  "workflowRefField": "workflow_id"
}
```

- `idField` 缺省为 `id`；其余字段缺省表示“该能力不可用”。
- 激活时逐字段对照类定义校验；拼错会在激活时报错。
- 声明了 `runContract`，激活会生成“我的待办”“单据详情”两个已发布 MetricView。
- 多个流程共用运行类时，必须声明 `workflowRefField`，并由创建单据的 Action 写入流程 ID。
- `scope` 里用到 `self_organization/self_subtree/self_descendants` 时必须有 `orgField`；`initiated_by_self` 要 `initiatorField`；`assigned_to_self` 要 `assigneeField`。

### 5.3 步骤

```json
{
  "name": "请假申请",
  "description": "公司固定请假流程",
  "runClassName": "leave_request",
  "runContract": { "...": "..." },
  "steps": [
    {
      "stepNo": 1,
      "name": "提交申请",
      "roleCode": "DEPARTMENT_EMPLOYEE",
      "actionId": "act_leave_start",
      "actionType": "execute",
      "scope": "all",
      "description": "申请人提交"
    },
    {
      "stepNo": 2,
      "name": "部门领导审批",
      "roleCode": "DEPT_LEADER",
      "actionId": "act_leave_approve",
      "actionType": "approve",
      "scope": "self_subtree",
      "description": "审批本部门子树内的申请"
    }
  ]
}
```

当前 `WorkflowStep` 的真实字段只有：`stepNo / name / roleCode / actionId / actionType / scope / description`。
平台**不会**返回步骤级 `input / executor / assignee / decider`；这些是运行时的输入，不是定义。

- `name` 必须非空且互不重复（`WorkflowStep.requireDistinctNames`）。
- `roleCode` 在**激活时**才解析成角色 id；名字写错会在激活时报 `The workflow names a role that does not exist in this domain: X`。
- `actionType=approve` 会强制该步为 human，即使 Action 写 auto。
- `scope` 是授权范围，不是“谁当前是负责人”。

### 5.4 存草稿、激活

```bash
node client.mjs wf-save @workflow.json
node client.mjs wf-query <workflowId>
node client.mjs wf-activate <workflowId>
```

- 保存后是 `DRAFT`，**不授予任何权限**。
- 激活是审批时刻：分配新版本号、冻结步骤、把每个“角色×动作”写进 `sys_role_capability`、追加 `Activated` 事件、生成两个查询。
- 激活响应里的 `activationNotes` 是生成告警：为空表示两个查询都生成了；有内容说明某个没生成。**不要当普通成功忽略。**
- 重复激活同一份未改步骤会 `version+1` 并重发授权行；不要用它“再试一次”。
- 要换版本：改草稿再激活；不要删生效中的流程（删不掉，且撤权必须先失效留记录）。

### 5.5 失效与删除

```bash
node client.mjs wf-deactivate <workflowId>   # 回收该版本授权，保留定义与记录
node client.mjs wf-delete <workflowId>       # 只对草稿/已失效流程
```

---

## 5.5 Case 型临时流程

临时流程没有业务事实类，环节间的信息由 Praxis 的 Case 承载。管理员建这种流程时：

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

要点：

- `temporary: true` + `runClassName: "workflow_case"`：跳过业务事实类和 `runContract` 的固定类校验。
- `caseScoped: true`：激活时**不**写 `role × action` 全局授权；执行时只允许 Case 当前 assignee。`wf-grants` 里看不到这些步骤是正常的。
- `inputBindings`：Action 参数从 Case payload 取；`locked` 的字段办理人改不了。
- `caseFormSchema` 只支持 `type/required/enum/const/min/max/minLength/maxLength`。
- 验收：`verify <workflowId>` 允许 `temporary=true` 代替 `runContract`；再让发起人跑一次 `case-submit`/`case-fill`，确认 payload 校验和绑定参数生效。
- 清理：先让 Case `case-close`，再 `wf-deactivate` + `wf-delete`；Case 本身在 Praxis 账本里随 run 保留。

---

## 6. 阶段 4：Trigger（何时自动开始）

触发器是能力层对象，表 `trigger_def`。当前只有两种组合能保存：

- 条件：`time`
- 效果：`action` 或 `workflow`

其他条件（Definition 成员变化、MetricView 阈值、Action 完成）和其他效果（Skill、通知）**保存时直接拒绝**，不会存下一个永远不会触发的定义。

```bash
node client.mjs trigger-save '{
  "name":"每天九点发起巡检",
  "conditionKind":"time",
  "condition":{
    "frequency":{"kind":"daily","time":"09:00"},
    "timeZone":"Asia/Shanghai"
  },
  "effectKind":"workflow",
  "effect":{"workflowId":"<workflowId>","requester":"<loginCode>"},
  "executor":"<subjectId>",
  "enabled":true
}'
node client.mjs trigger-list
node client.mjs trigger-status <triggerId> PUBLISHED true
node client.mjs trigger-run <triggerId>       # 手动点火一次
```

- 频率支持 `interval / daily / weekly / monthly / cron`。
- `trigger/save` 默认 `PENDING_REVIEW`；`trigger/status PUBLISHED` 才布防（enabled 自动为 true）。
- `effect=workflow` 只调用 Praxis `POST /runs`，**不推进**；推进由 Praxis 的 engine 完成。
- 幂等键是 `<triggerId>:<epochSecond>`；同一槽重复点火在账本侧 409，不会产生第二条 Run。
- 调度器每秒取一次 due，先占槽再点火；崩溃最多丢一次，不会重复写业务。
- 触发器只支持单副本；多副本需要数据库层抢占（当前没有）。

---

## 7. 阶段 5：验收（必须做）

### 7.1 静态检查

```bash
node client.mjs verify <workflowId>
```

它检查：

- `status=ACTIVE`、`version>=1`
- `activationNotes` 为空
- `runContract` 已声明
- 每个步骤有 `roleCode`、`actionId`
- 每个 `roleCode` 在本域至少有一个成员（通过 `subjects` + `grants` 的 roleId 映射）

任何一项失败都先修定义，不要进入运行验收。

### 7.2 动态验收

用各步骤角色的账号，按顺序执行 Action（拉式）：

1. 发起人跑发起动作，得到 `run_id`，业务对象进入第一步。
2. 每一步负责人跑该步动作；动作的 `submissionCriteria` 决定是否轮到。
3. 每步后核对：`current_node` 前进、`status` 变化。
4. 反面用例必须走：
   - 不是你的回合：重复跑上一步动作 → 前置条件失败。
   - 无授权：不持有该步角色的人跑 → `notGranted`。
   - 驳回：`decision/rejected` → 状态变驳回且不再前进。

如果流程走 Praxis（有账本/待办），运行侧用 `ontomato-process-operator`：`inbox` → `decide`。

### 7.3 触发器验收

```bash
node client.mjs trigger-run <triggerId>
```

看返回的 `status/runId`；再查 Praxis `/runs/<runId>`（operator skill）或业务对象是否产生。

---

## 8. 命令速查

| 命令 | 作用 |
|---|---|
| `login / me / ping` | 环境与身份 |
| `domains / domain-create` | 域列表/建域（superAdmin） |
| `subjects / users` | 主体与用户 |
| `org-tree` | 组织快照 |
| `org-unit-save / org-unit-delete` | 组织单位 |
| `member-save / member-remove / member-lock` | 组织成员 |
| `position-save / position-delete` | 岗位 |
| `grant-save / grant-delete` | 组织授权 |
| `roles / role-save` | 角色 |
| `role-members / role-posts` | 角色成员/岗位 |
| `posts / post-save` | 岗位 |
| `api-list / menu-list` | 权限项 |
| `post-api / post-menu / post-data` | 岗位 API/菜单/数据权限 |
| `data-permission-save / data-permission-delete` | 数据权限 |
| `actions / action-get / action-import / action-reexplain` | Action |
| `wf-save / wf-query / wf-activate / wf-deactivate / wf-delete` | Workflow |
| `wf-grants / wf-access` | 生效授权/平台操作 |
| `trigger-*` | 触发器 |
| `verify` | 静态验收 |

写命令都支持 `--dry-run`，只打印请求体，不登录、不落库。

---

## 9. 硬约束与坑（代码事实）

1. **一个域只有一棵组织树**；第二个根会被拒绝。
2. `unit/save` 忽略传入 `code`，自动生成 `org-<uuid>`；不要拿 code 当业务主键。
3. 删除单位/岗位/授权有引用检查；先清子项、成员、授权。
4. `position-save` 必须带 `assigneeIds` 数组；空数组是“清空”，缺字段是错误。
5. `role-members` / `role-posts` / `post-api` / `post-menu` 底层都是 **replace**；客户端做了并集，手工调接口要自己保全。
6. `role-save` 缺 `roleDesc` 会 NPE；客户端已补默认值。
7. `roleType=1` 是管理角色；普通业务角色用 `0`。
8. 角色不直接持有 API/菜单权限；权限挂在岗位上。
9. 数据权限的 `permission` 是字符串化 JSON；行/字段两种 `dataType`。
10. `Action` 发布后代码冻结；要改新建动作。
11. `approvalMode=twoKeys` 没有双人实现，只编译成 human。
12. `Workflow` 保存后是 DRAFT，不授权；必须激活。
13. 步骤字段只有 `stepNo/name/roleCode/actionId/actionType/scope/description`；`input/executor/assignee` 不是定义字段。
14. 激活时才校验 `roleCode` 是否存在；保存时不报错。
15. `activationNotes` 非空说明待办/详情查询没生成；不要忽略。
16. 重复激活未改步骤会 `version+1` 并重发授权；不要用它重试。
17. 生效中的流程不能删；先 `wf-deactivate`。
18. Trigger 只有 `time` 条件 + `action/workflow` 效果可保存；其他在 `validate()` 拒绝。
19. Trigger 发布才布防；`triggerKey` 按秒幂等。
20. `workflow/query` 不返回步骤级 input/executor/assignee；运行输入在创建 Run 时给。
21. 域管理员的初始密码由 `DomainSvcImpl.create` 固定为 `admin`（本地/测试用；生产要改）。
22. 组织授权的 `self_*` 按 recipient 的基组织解析，不填 targetId/userId。
23. 跨源不能 JOIN；账本是 Praxis 的独立 schema，业务对象与账本两步查。
24. 本技能不创建用户；成员必须是域内已有主体（`subjects`）。

---

## 10. 安全

- 组织/角色/授权/流程都是**真实域数据**；删除和失效前先确认。
- 不要为了“跑通”把管理员永久塞进业务角色；验收后恢复。
- 不要把密码、token、API Key 写进 skill 文件或对话；用环境变量。
- 生产环境和测试环境分开；`import-schema` 会清空当前域，绝不要指向有业务数据的域（本技能不包含该命令）。
