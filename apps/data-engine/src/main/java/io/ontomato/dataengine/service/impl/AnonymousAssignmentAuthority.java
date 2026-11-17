package io.ontomato.dataengine.service.impl;

import org.springframework.stereotype.Component;

import io.ontomato.dataengine.service.AssignmentAuthority;

/**
 * The open-source answer: there is no organization model, so the organizational constraint does not apply.
 *
 * <p>Empty rather than permissive-by-accident: an edition without departments cannot answer "is this person inside your
 * scope", and refusing every assignment would make the edition unusable while enforcing a structure it does not
 * have.</p>
 */
@Component
public class AnonymousAssignmentAuthority implements AssignmentAuthority {

    @Override
    public Decision canAssign(String domainId, String from, String to) {
        return Decision.ALLOW;
    }
}
