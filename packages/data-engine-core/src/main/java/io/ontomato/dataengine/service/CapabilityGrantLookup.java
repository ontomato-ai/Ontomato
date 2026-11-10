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

    /**
     * Whether the subject may use the capability.
     *
     * @param kind one of {@link #KINDS}
     * @param capabilityId the id of the capability object (for an action, the action id)
     */
    boolean allows(String userId, String domainId, String kind, String capabilityId);
}
