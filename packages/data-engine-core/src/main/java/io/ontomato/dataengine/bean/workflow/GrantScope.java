package io.ontomato.dataengine.bean.workflow;

/** Frozen authorization for one role, capability and step. */
public record GrantScope(Kind kind, String className, String field) {
    public enum Kind { all, self_organization, self_subtree, self_descendants, initiated_by_self, assigned_to_self }
    public static final GrantScope ALL = new GrantScope(Kind.all, null, null);

    public GrantScope {
        if (kind == null || (kind == Kind.all ? className != null || field != null
                : className == null || className.isBlank() || field == null || field.isBlank()))
            throw new IllegalArgumentException("Scope requires all, or a kind with its target class and field");
    }

    public void requireTarget(io.ontomato.dataengine.bean.action.ActionTarget target, java.util.Map<String, Object> rule) {
        if (kind == Kind.all) return;
        if (target == null || !className.equals(target.className()))
            throw new IllegalArgumentException("Scope " + kind + " requires an Action target of class " + className);
        var attrs = (java.util.List<java.util.Map<String, Object>>) target.definition(rule).get("attrs");
        if (attrs.stream().noneMatch(a -> field.equals(a.get("name")) && !Boolean.FALSE.equals(a.get("enable"))))
            throw new IllegalArgumentException("Unknown scope field: " + className + "." + field);
    }

    public static GrantScope freeze(Kind kind, RunContract contract) {
        if (kind == Kind.all) return ALL;
        if (contract == null) throw new IllegalArgumentException("Scope " + kind + " requires a runContract");
        String field = switch (kind) {
            case self_organization, self_subtree, self_descendants -> contract.getOrgField();
            case initiated_by_self -> contract.getInitiatorField();
            case assigned_to_self -> contract.getAssigneeField();
            default -> throw new IllegalArgumentException("Unknown scope: " + kind);
        };
        return new GrantScope(kind, contract.getClassName(), field);
    }
}
