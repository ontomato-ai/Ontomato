# Action 中的 Praxis 脚手架

仅当 Action 需要启动或推进 Ontomato Workflow 时阅读本参考。使用平台注入的
`query_runtime` 中的 `praxis_*` 脚手架，不要自己写 Praxis 地址、端口或认证头。

## 身份与失败

- 运行时注入 `ONTOMATO_PRAXIS_URL`、当前用户的 `ONTOMATO_CALLER_TK` 和域请求头。
- `requester`、`assignedBy`、`decider` 和 Case actor 都来自当前登录人。不要把
  caller token 声明成 Action 参数，也不要冒充其他主体。
- helper 成功时直接返回 Praxis 的 JSON 对象或数组，没有 `{success, data}` 包装。
- 非 2xx、`{error: ...}` 或 `{success: false}` 会抛出 `RuntimeError`。

## 函数契约

| Helper | 入参 | 返回 |
| --- | --- | --- |
| `praxis_list_runs(status=None, limit=None, target_class=None, target_id=None)` | 查询条件；`target_class` 和 `target_id` 必须同时传 | `RunSummary[]` |
| `praxis_get_run(run_id)` | Run ID | `RunRecord` |
| `praxis_start_run(workflow_id, inputs=None, assignments=None, acts_on=None, goal_text=None, auto=True)` | Workflow ID 和可选创建数据 | `RunRecord` |
| `praxis_tick_run(run_id)` | Run ID | 更新后的 `RunRecord` |
| `praxis_bind_run(run_id, target_class, target_id)` | Run ID 和一个业务对象 | 更新后的 `RunRecord` |
| `praxis_assign_step(step_id, principal=None, assigned_by=None)` | 运行时步骤 ID；`principal=None` 表示清空指派 | 更新后的 `RunRecord` |
| `praxis_decide_step(step_id, verdict, comment=None)` | 运行时步骤 ID；结论为 `approve` 或 `reject` | 决定并 tick 后的 `RunRecord` |
| `praxis_inbox(assignee=None)` | 可选主体，默认当前登录人 | `InboxItem[]` |
| `praxis_subjects(role=None)` | 可选角色编码 | `CandidateReport` |
| `praxis_step_candidates(step_id)` | 运行时步骤 ID | `CandidateReport` 加步骤字段 |
| `praxis_case(run_id)` | Run ID | `CaseRecord` |
| `praxis_case_submit(run_id, payload)` | Run ID 和 payload 对象 | 更新后的 `CaseRecord` |
| `praxis_case_fill(run_id, payload)` | Run ID 和 payload 对象 | 更新后的 `CaseRecord` |
| `praxis_case_close(run_id)` | Run ID | 更新后的 `CaseRecord` |

## 发起 Run 的格式

```python
run = praxis_start_run(
    workflow_id="campus_midterm_check_v1",
    # 模板步骤 ID -> 该步骤的参数对象。
    inputs={
        "s1": {"task_id": params["task_id"]},
        "s2": {"task_id": params["task_id"]},
    },
    # 模板步骤 ID -> candidate.principal，通常就是 loginCode。
    assignments={
        "s1": params["teacher"],
        "s2": params["director"],
    },
    # 业务对象使用列表。
    acts_on=[
        {"targetClass": "school_task", "targetId": params["task_id"]},
    ],
)
```

不要把任意成员 ID 当成 `candidate.principal`。它应从
`praxis_step_candidates(step_id)` 或 `praxis_subjects(role=...)` 获取。

## 返回结构

`RunSummary` 只用于列表：

```text
id, templateRef, status, requester, createdAt, updatedAt
```

摘要没有 `steps`。需要判断或办理步骤时必须先读取完整 Run。

`RunRecord` 常用字段：

```text
id, status, requester, actsOn, steps
```

步骤常用字段：

```text
id, stepRef, status, assignee, assignedTo,
decision, output, error
```

`steps[].id` 是运行时步骤 ID，用于 assignment/decision helper；
`steps[].stepRef` 才是 `s1`、`s2` 这类模板步骤名，两者不能混用。

`CandidateReport`：

```text
roleCode, degraded, fallback,
candidates[{principal, displayName, roleIds}]
```

步骤候选还会带 `stepId`、`stepRef`、`assignee`、`assignedTo`。
`degraded: true` 表示该部署没有主体目录，不等于这个角色没有成员。

`InboxItem`：

```text
runId, stepId, stepRef, assignee, assignedTo,
capabilityRef, input, waitingSince
```

`CaseRecord`：

```text
id, runId, workflowId, formSchema, payload, status, currentStep,
requester, assignee, actsOnRefs, createdAt, updatedAt
```

## 幂等

创建超时后，先按业务对象查询已有 Run，再决定是否重试：

```python
existing = praxis_list_runs(
    target_class="school_task",
    target_id=params["task_id"],
    limit=2,
)
if existing:
    run = praxis_get_run(existing[0]["id"])
else:
    run = praxis_start_run(...)
```

如果返回多条 Run，不要猜应该复用哪一条。应按业务规则补充 Workflow/状态条件，
或明确报告歧义。
