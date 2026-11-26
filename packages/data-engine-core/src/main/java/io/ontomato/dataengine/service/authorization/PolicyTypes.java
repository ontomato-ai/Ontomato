package io.ontomato.dataengine.service.authorization;

/**
 * Stored policy types, i.e. {@code sys_post.post_type}. The numbers are part of released data:
 * 1 and 2 keep their meaning so an upgrade never rewrites a customer's existing policies.
 */
public final class PolicyTypes {
    private PolicyTypes() {}

    /** Platform management operations, granted one by one as read or change. */
    public static final int MANAGEMENT = 1;

    /** Business data: row rules and field rules for the classes of this domain. */
    public static final int BUSINESS_DATA = 2;

    /** Entries and the objects an entry brings out: panels, projections, components, agents, actions, metrics. */
    public static final int OBJECT = 3;
}
