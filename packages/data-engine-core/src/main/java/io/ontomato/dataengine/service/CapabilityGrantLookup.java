package io.ontomato.dataengine.service;

import java.util.Map;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import java.util.Set;

/**
 * Whether the acting subject may use one capability object.
 *
 * <p>A capability is authorized as a whole object, not as an endpoint: "may run 审批通过@v5" is a
 * grant, while "may call POST /action/execute" is not. The action executor asks here before it starts,
 * so an unpublished-in-this-role action never reaches its program — being able to see an action in the
 * catalogue is not being allowed to run it.</p>
 *
 * <p>The open-source edition has no subjects to authorize and answers yes; the enterprise edition
 * resolves the member's effective roles and their granted capabilities in the domain.</p>
 */
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

    Admission admission(String userId, String domainId, String kind, String capabilityId);
}
