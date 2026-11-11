package io.ontomato.dataengine.service;

import io.ontomato.dataengine.core.bean.User;
import java.util.List;

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
    /** A list of organization codes in the subject's domain. */
    String ORG = "org";

    /**
     * The value of one subject attribute.
     *
     * @return one string for an account field, a list of strings for a custom attribute, or null when
     *     the subject has no such attribute or has cleared it
     */
    Object attribute(User user, String source, String attribute);

    List<String> organizationCodes(User user, OrganizationScope scope);

    /**
     * The account field names this edition offers, used to refuse a reference to a field that does not
     * exist while the definition is still being written.
     *
     * <p>An edition that reports none is not second-guessed: the check is skipped there and execution
     * still fails closed on an unresolvable reference.</p>
     */
    default List<String> supportedAccountFields() {
        return List.of();
    }
}
