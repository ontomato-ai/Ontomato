package io.ontomato.dataengine.service;

import io.ontomato.dataengine.core.bean.User;

/**
 * One attribute of the acting subject, read for precondition evaluation.
 *
 * <p>Preconditions may compare the pre-action object state with the subject that is executing the
 * action ("only my own report"): the value comes from here, never from the request body, so a caller
 * cannot claim to be someone else by passing a parameter.</p>
 *
 * <p>The open-source edition knows only the account fields of its anonymous user; the enterprise
 * edition adds the custom permission attributes of the member in the current domain.</p>
 */
public interface SubjectAttributeLookup {

    /** Account profile of the user, addressed as {@code account.<attribute>}. */
    String ACCOUNT = "account";
    /** Custom permission attributes of the member, addressed as {@code principal.<attribute>}. */
    String PRINCIPAL = "principal";

    /**
     * The value of one subject attribute.
     *
     * @return one string for an account field, a list of strings for a custom attribute, or null when
     *     the subject has no such attribute or has cleared it
     */
    Object attribute(User user, String source, String attribute);
}
