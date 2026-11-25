# Customer `ObjectType` forms and targetless Actions

Customer ontology classes (such as `Student`, `Course`, `Order`) support standard `ObjectForm` editing and creation
through the platform's generic `form` / `createForm` reads paired with published `Action`s.

### 1. Edit an existing customer object (`ObjectForm` + object-targeted `Action`)

- Bind `type: "<Class>"`, `target: "<selectedState>"`, `data: { form: "form" }`, and bind a write `Action` under
  `operations.save` (or `operation` + `operationParams`).
- **Editable fields are strictly governed by the bound save `Action` and its parameter wiring:**
  - Any Action parameter not explicitly listed in `params` connects directly by the same name to form field `/<param>`.
  - Use `{ "formField": "/pointer" }` to map a differently named or nested form attribute to an Action parameter.
  - Use `{ "formFields": { "key": "/pointer", ... } }` to pack multiple form fields into a JSON object Action parameter.
  - Use `{ "literal": value }` or `{ "input": "portName" }` for fixed or input-sourced parameters.
  - **Attributes not accepted by the bound Action are automatically rendered read-only.** Make sure your save Action's
    parameters cover every attribute you want users and agents to edit.
  - **Clearing nullable fields:** Clearing a previously populated nullable field explicitly submits `""` (or `"null"` for
    JSON parameters) so intentional clears are never dropped.

```json
{
  "studentForm": {
    "component": "ObjectForm",
    "type": "Student",
    "target": "selected",
    "data": { "form": "form" },
    "operations": {
      "save": {
        "operation": "action-update-student",
        "params": {
          "student_name": { "formField": "/name" },
          "profile": { "formFields": { "grade": "/grade", "note": "/remark" } }
        }
      }
    },
    "config": { "actions": "none" }
  }
}
```

### 2. Create a customer object or run a global Action (targetless `Action`, `target: null`)

- Targetless customer Actions (creating a new object, importing, batch generation, etc.) do **not** invent a new `kind`.
  In the author type table, they live once at the top level under `operations` keyed uniquely by Action ID, with
  `target: { source: "none" }` and `affects: ["Order", ...]` for discovery and automatic post-write refresh.
  - `panel type <ObjectType>` directly lists top-level targetless Actions whose `affects` include `<ObjectType>` under
    `targetlessOperations` (annotated with `targetless: true` and `callTarget: null`); run `panel type --all` to inspect
    every top-level targetless Action (including ones that did not declare `affects`).
  - When an agent invokes one via `/operate`, it sends `call.target: null`.
- **Example A — `ObjectForm` in create mode bound to a targetless `Action`:**

```json
{
  "orderCreateForm": {
    "component": "ObjectForm",
    "type": "Order",
    "data": { "createForm": "createForm" },
    "operations": {
      "save": {
        "operation": "action-create-order",
        "params": {
          "customer_name": { "formField": "/customer" }
        }
      }
    },
    "config": { "actions": "create-only" }
  }
}
```

- **Example B — `OperationButton` bound to a targetless `Action`:**
  Omit `target`. When the Action declares `values` parameters, clicking the button automatically opens the parameter
  collection dialog, validates inputs, confirms, and dispatches with `target: null`:

```json
{
  "createOrderBtn": {
    "component": "OperationButton",
    "operation": "action-create-order",
    "config": { "label": "New Order", "type": "primary", "icon": "plus" }
  }
}
```

### 3. Two valid ways to wrap up after creation (`@saved`)

1. **Action owner returns the new object identity (`saved?.primaryKey`):** You may close the create dialog and select
   or navigate to the newly created object's detail view (`panelAddress(DETAIL_PATH, { selected: saved.primaryKey })`).
2. **Action owner returns no new identity (`saved.primaryKey === null`):** Close/reset the create form or
   dialog and let `affected.objectTypes` (`affects`)
   auto-refresh sibling lists and metrics (both humans and agents follow the same behavior). If your flow requires
   "jump straight to the newly created record's detail page", have the Action owner return the created object identity in
   the capability layer.

### 4. Current capability boundaries (customer forms & targetless Actions)

Design your Actions and panel UX around these four current runtime boundaries:

1. **Restricted data-scope grants reject targetless creates (`ACTION_TARGET_OUT_OF_SCOPE`):** If a role is granted a
   targetless create Action only under a restricted data scope (rather than unrestricted scope), the owner rejects
   execution with `ACTION_TARGET_OUT_OF_SCOPE` for both humans and agents alike.
2. **Missing `affects` skips post-create auto-refresh:** If a create Action omits `affects` (the affected object types),
   lists and metrics for that class will **not** auto-refresh after creation. Always declare `affects` on create Actions.
3. **New identity comes from `created`:** A create owner returns `{ kind: "success", created: { objectType, primaryKey }, ... }`
   to identify the new object. The platform carries it in `operation.created`. `ObjectForm` emits `saved` with the
   corresponding `{ className, primaryKey }`, where `primaryKey` is `null` for success without a reported identity.
   Use that key for navigation. Plain result text and `affected.objects` carry no create identity contract.
4. **Clearing text fields sends `""` (not SQL `NULL`):** Current nullable text clearing submits `""` (empty string) and
   cannot yet distinguish database `NULL` from `""` on text attributes.

### 5. Cross-member write submitting a form draft (`draft`)

When a button or operation declared on **another** member submits a form member's current draft, explicitly specify
`draft: "<formMemberKey>"` in that member's operation binding (either top-level `draft` on `OperationButton` or inside
`operations.<name>.draft`), so the platform and agents know which form draft is being submitted.
