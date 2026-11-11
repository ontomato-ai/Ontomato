package io.ontomato.dataengine.service;

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
    }

    Admission admission(String userId, String domainId, String kind, String capabilityId);
}
