import { describe, expect, it } from "vitest";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelFormField } from "@ontomato/contracts/panel-projection";
import { validateFormFieldValue } from "../../../apps-sdk/src/base/form-placement";

const available = { value: 1, label: "Read", description: null, disabled: false, disabledReason: null };
const blocked = { ...available, value: "write", disabled: true, disabledReason: "Write is locked" };
const row = { key: "open", label: "Open", disabled: false, disabledReason: null };
const locked = { ...row, key: "locked", disabled: true, disabledReason: "Row is locked" };

function validate(control: PanelFormField["control"], next: RuntimeJsonValue, current: RuntimeJsonValue) {
  const field = { path: "/field", label: "Field", required: false, readOnly: false, valueSchema: {}, control };
  return validateFormFieldValue(field, field.path, next, { field: current }, {});
}

describe("agent form choices", () => {
  it("retains or removes historical and disabled multi-select choices without admitting new unavailable choices", () => {
    const select = { kind: "select", multiple: true, options: [available, blocked] } as const;
    const current = ["legacy", "write"];
    const control = { ...select, options: [...select.options] };
    expect(validate(control, ["legacy", "write", 1], current)).toBeNull();
    expect(validate(control, [1], current)).toBeNull();
    expect(validate(control, ["another"], current)?.reason).toBe("invalid_value");
    expect(validate(control, ["write"], [])?.message).toBe(blocked.disabledReason);
    expect(validate({ ...control, allowCreate: true }, ["another"], current)).toBeNull();
    expect(validate({ ...control, allowCreate: true }, ["write"], [])?.message).toBe(blocked.disabledReason);
  });

  it("uses JSON equality for current object choices and applies the same rule to single values", () => {
    const old = { scope: "old", id: 1 };
    const held = { id: 1, scope: "old" };
    const control = { kind: "select" as const, options: [{ ...available, value: { id: 2 } }] };
    expect(validate(control, held, old)).toBeNull();
    expect(validate({ ...control, multiple: true }, [held, { id: 2 }], [old])).toBeNull();
    expect(validate(control, { ...held, id: 3 }, old)?.reason).toBe("invalid_value");
    expect(validate(control, { id: 2 }, old)).toBeNull();

    const scalar = { kind: "select" as const, options: [available, blocked] };
    expect(validate(scalar, "old", "old")).toBeNull();
    expect(validate(scalar, "write", "write")).toBeNull();
    expect(validate(scalar, "write", 1)?.message).toBe(blocked.disabledReason);
    expect(validate(scalar, "old", 1)?.reason).toBe("invalid_value");
  });

  it("retains historical rows and tiers but forbids adding them or changing and deleting disabled rows", () => {
    const control = { kind: "choice-matrix" as const, options: [available, blocked], rows: [row, locked] };
    const current = { open: "retired tier", locked: "write", retired: 1 };
    expect(validate(control, current, current)).toBeNull();
    expect(validate(control, { open: 1, locked: "write" }, current)).toBeNull();
    expect(validate(control, { ...current, retired: "write" }, current)?.reason).toBe("invalid_value");
    expect(validate(control, { ...current, unknown: 1 }, current)?.reason).toBe("invalid_value");
    expect(validate(control, { open: 1 }, current)?.message).toBe(locked.disabledReason);
    expect(validate(control, { ...current, locked: 1 }, current)?.message).toBe(locked.disabledReason);
    expect(validate(control, { locked: 1 }, {})?.message).toBe(locked.disabledReason);
    expect(validate(control, { ...current, open: "other" }, current)?.reason).toBe("invalid_value");
    expect(validate(control, { ...current, open: "write" }, current)?.message).toBe(blocked.disabledReason);
    expect(validate(control, { open: "write" }, { open: "write" })).toBeNull();

    for (const value of [null, [], "write"]) {
      expect(validate(control, value, current)?.reason).toBe("invalid_value");
    }
  });
});
