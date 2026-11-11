# Acting on a case

`run` performs one step of one process. `pending` shows what is waiting for you. Neither can be
persuaded to do more than the platform allows, and that is the point: a refusal names the layer that
refused it, so the caller knows whether to ask an administrator, wait, or fix the case.

## The order the executor checks

| # | Layer | Refusal reads | What it means | What to do |
|---|---|---|---|---|
| 1 | Platform permission | `无此权限：/action/execute` | Your role lacks the API permission for the execute endpoint | Ask an administrator to attach the API position that carries it |
| 2 | Capability grant | `No role grants this action to the current subject` | No **active** process revision grants this action to any role you hold | The step is not yours, or the revision that names your role is not active |
| 3 | Preconditions | `Action preconditions are not met: <reasons>` | The case is not in the state this step expects, or it is not assigned to you | The reasons are the author's own words; read them literally |
| 4 | Data permission | `403 Class is outside the authorized scope` | Your role may not read the class this step inspects | Data permission is separate from the capability grant |

A draft or inactive process confers nothing: activating a revision is what writes the grants.

## `pending`

Read-only. Select the published pending metric of an active workflow by its recorded source.
The server matches the current step and its grants, then applies your row permissions.
The client does not build a substitute query or take an identity parameter.

```bash
node ontomato.mjs pending
node ontomato.mjs pending --flow 开虚机申请审批 --limit 50
```

Output shape:

```json
{"source":"metric","metric":"我的待办 · 开虚机申请审批","revision":"3","count":1,
 "rows":[{"id":"VM-1","current_node":"部门领导审批","status":"待办"}]}
```

`source` is `metric`. For multiple workflows, `items` groups the results by workflow ID. Zero rows is a real answer; a missing query is an error, and
it says so instead of returning an empty list.

## `run`

```bash
node ontomato.mjs run act_vm_dept_approve @params.json
node ontomato.mjs run act_vm_dept_approve '{"run_id":"VM-1","result":"approved"}'
```

Output on success:

```json
{"ok":true,"actionId":"act_vm_dept_approve","result":{"completed":true},"spendTimeMs":812}
```

A write action's program output is replaced by `{"completed":true}`; the case itself is the record.
Read the case back with `pending` or a query to confirm what changed.

Output on refusal (exit code 1):

```json
{"ok":false,"actionId":"act_vm_dept_approve",
 "error":"This is not your turn: 这一步还没轮到",
 "raw":"Action preconditions are not met: 这一步还没轮到"}
```

## Do not work around a refusal

- **Do not pass an identity.** There is no identity parameter; the executor reads the authenticated
  subject. Supplying a subject id in the parameters changes what the program sees, not who you are.
- **Do not retry with different parameters** when the refusal is "not your turn". The state moved on
  or never reached you; retrying cannot change either.
- **Do not treat a refusal as an empty result.** "Not granted" means you cannot act; "no rows" means
  there is nothing to act on. They lead to different next steps.
- **Do not use `run` to check whether a step exists.** Use `pending` or a query; `run` writes.
