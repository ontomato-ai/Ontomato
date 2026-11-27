# Praxis helpers for Actions

Read this reference only when an Action starts or advances an Ontomato workflow.
Use the `praxis_*` helpers from the runtime-provided `query_runtime`; do not call a
Praxis URL or construct authorization headers yourself.

## Identity and failures

- The runtime injects `ONTOMATO_PRAXIS_URL`, the current user's
  `ONTOMATO_CALLER_TK`, and the domain header.
- `requester`, `assignedBy`, `decider` and Case actor are derived from the signed-in
  caller. Never declare a caller token or impersonate another subject in an Action.
- A successful helper returns the Praxis JSON object or array directly. It does not
  wrap the result in `{success, data}`.
- A non-2xx response, `{error: ...}`, or `{success: false}` raises `RuntimeError`.

## Helper contract

| Helper | Inputs | Result |
| --- | --- | --- |
| `praxis_list_runs(status=None, limit=None, target_class=None, target_id=None)` | Filters; `target_class` and `target_id` must be supplied together | `RunSummary[]` |
| `praxis_get_run(run_id)` | Run id | `RunRecord` |
| `praxis_start_run(workflow_id, inputs=None, assignments=None, acts_on=None, goal_text=None, auto=True)` | Workflow id and optional creation data | `RunRecord` |
| `praxis_tick_run(run_id)` | Run id | Updated `RunRecord` |
| `praxis_bind_run(run_id, target_class, target_id)` | Run id and one business target | Updated `RunRecord` |
| `praxis_assign_step(step_id, principal=None, assigned_by=None)` | Run-time step id; `principal=None` clears a pin | Updated `RunRecord` |
| `praxis_decide_step(step_id, verdict, comment=None)` | Run-time step id; verdict is `approve` or `reject` | Updated `RunRecord` after the decision and tick |
| `praxis_inbox(assignee=None)` | Optional principal; defaults to the caller | `InboxItem[]` |
| `praxis_subjects(role=None)` | Optional role code | `CandidateReport` |
| `praxis_step_candidates(step_id)` | Run-time step id | `CandidateReport` plus step fields |
| `praxis_case(run_id)` | Run id | `CaseRecord` |
| `praxis_case_submit(run_id, payload)` | Run id and payload object | Updated `CaseRecord` |
| `praxis_case_fill(run_id, payload)` | Run id and payload object | Updated `CaseRecord` |
| `praxis_case_close(run_id)` | Run id | Updated `CaseRecord` |

## Creation shapes

```python
run = praxis_start_run(
    workflow_id="campus_midterm_check_v1",
    # Template step id -> the parameter object for that step.
    inputs={
        "s1": {"task_id": params["task_id"]},
        "s2": {"task_id": params["task_id"]},
    },
    # Template step id -> candidate.principal, normally loginCode.
    assignments={
        "s1": params["teacher"],
        "s2": params["director"],
    },
    # Business targets are a list.
    acts_on=[
        {"targetClass": "school_task", "targetId": params["task_id"]},
    ],
)
```

Do not pass a database member id in place of `candidate.principal`. Obtain the
principal from `praxis_step_candidates(step_id)` or `praxis_subjects(role=...)`.

## Result shapes

`RunSummary` is deliberately small:

```text
id, templateRef, status, requester, createdAt, updatedAt
```

A summary has no `steps`, so read the full Run before deciding or advancing a step.

`RunRecord` contains:

```text
id, status, requester, actsOn, steps
```

The commonly used step fields are:

```text
id, stepRef, status, assignee, assignedTo,
decision, output, error
```

`steps[].id` is the run-time step id used by assignment and decision helpers.
`steps[].stepRef` is the template step name such as `s1`. They are not
interchangeable.

`CandidateReport` contains:

```text
roleCode, degraded, fallback,
candidates[{principal, displayName, roleIds}]
```

For step candidates, the same report also contains `stepId`, `stepRef`,
`assignee` and `assignedTo`. `degraded: true` means the deployment publishes no
subject directory; it does not mean the role simply has no members.

`InboxItem` contains:

```text
runId, stepId, stepRef, assignee, assignedTo,
capabilityRef, input, waitingSince
```

`CaseRecord` contains:

```text
id, runId, workflowId, formSchema, payload, status, currentStep,
requester, assignee, actsOnRefs, createdAt, updatedAt
```

## Idempotency

Before retrying a timed-out create, query the existing Run by business target:

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

If more than one Run matches, do not guess which one to reuse. Report the
ambiguity or apply an explicit workflow/status rule from the business requirement.
