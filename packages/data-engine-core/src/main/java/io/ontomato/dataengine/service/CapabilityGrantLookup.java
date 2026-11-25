package io.ontomato.dataengine.service;

import java.util.Map;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import java.util.Set;

/** Reads the effective admissions of a frozen workflow revision. */
public interface CapabilityGrantLookup {

    /** Action capabilities, granted as "who may run this action". */
    String ACTION = "ACTION";

    /** The capability kinds a role can be granted. */
    Set<String> KINDS = Set.of(ACTION);

    /** Conditions are alternatives; each retains the target class authorized by its own grant. */
    record Match(String className, String field, java.util.List<String> values) {}
    record Admission(boolean unrestricted, java.util.List<Match> matches) {
        public static final Admission ALL = new Admission(true, java.util.List.of());
        public static final Admission DENIED = new Admission(false, java.util.List.of());
        public boolean admitted() { return unrestricted || !matches.isEmpty(); }

        /** Keep the row anchor paired with the scope of this grant, even inside a union of steps. */
        public JSONObject restrict(String className, JSONObject anchor) {
            if (unrestricted) return anchor;
            var alternatives = new JSONArray();
            for (var match : matches) {
                if (className.equals(match.className()) && !match.values().isEmpty())
                    alternatives.add(JSONObject.of("field", match.field(), "operator", "in", "value", match.values()));
            }
            if (alternatives.isEmpty()) return io.ontomato.dataengine.util.DslPermissionUtil.alwaysFalse(anchor.getString("field"));
            return JSONObject.of("operator", "logic", "and", JSONArray.of(anchor,
                    JSONObject.of("operator", "logic", "or", alternatives)));
        }
    }

    /** Only grants of these frozen steps; a direct grant is not an assignment to a process step. */
    Map<Integer, Admission> stepAdmissions(String userId, String domainId, String workflowId, int version);

}
