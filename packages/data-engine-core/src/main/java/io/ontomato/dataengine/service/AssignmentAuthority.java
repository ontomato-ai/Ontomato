package io.ontomato.dataengine.service;

/**
 * Whether one subject may hand work to another.
 *
 * <p>This is deliberately a different question from {@link CapabilityGrantLookup}. That one answers "may this subject
 * run this action" — a capability question. This one answers "may this subject assign work to that subject" — an
 * organizational question. A department leader may hold every grant needed to approve, and still not be allowed to
 * assign work to another department's member.</p>
 *
 * <p>Kept in core as a contract with one implementation per edition, like {@link SubjectDirectory}: the open-source
 * edition has no organization model, so the constraint is inapplicable there and every assignment is allowed. That is
 * the same degenerate rule the subject directory follows — an absent model means the constraint does not hold, not that
 * nobody may assign.</p>
 */
public interface AssignmentAuthority {

    /** `reason` is written to the refusal so an operator learns which rule stopped the assignment, not just that it did. */
    record Decision(boolean allowed, String reason) {
        public static final Decision ALLOW = new Decision(true, null);

        public static Decision deny(String reason) {
            return new Decision(false, reason);
        }
    }

    /**
     * May `from` assign work to `to` in this domain?
     *
     * <p>Both are subject ids. Self-assignment is always allowed: a person assigning work to themselves is not an
     * organizational act.</p>
     */
    Decision canAssign(String domainId, String from, String to);
}
