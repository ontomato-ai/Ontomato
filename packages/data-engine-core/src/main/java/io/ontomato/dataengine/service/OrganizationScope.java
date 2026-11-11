package io.ontomato.dataengine.service;

import java.util.Locale;

/** Relative organization scopes shared by subject references and organization grants. */
public enum OrganizationScope {
    SELF_ORGANIZATION("self"), SELF_SUBTREE("selfAndDescendants"), SELF_DESCENDANTS("descendants");

    private final String attribute;
    OrganizationScope(String attribute) { this.attribute = attribute; }
    public String attribute() { return attribute; }
    public String key() { return name().toLowerCase(Locale.ROOT); }

    public static OrganizationScope fromAttribute(String name) {
        for (var scope : values()) if (scope.attribute.equals(name)) return scope;
        throw new IllegalArgumentException("Unknown organization reference: org." + name);
    }

    public static OrganizationScope fromReference(Object value) {
        if (!(value instanceof String text)) return null;
        var ref = SubjectReference.parse(text);
        return ref != null && SubjectAttributeLookup.ORG.equals(ref.source()) ? fromAttribute(ref.attribute()) : null;
    }
}
