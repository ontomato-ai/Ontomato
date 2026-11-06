package io.ontomato.dataengine.service.impl;

import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.SubjectAttributeLookup;
import java.util.Map;
import java.util.function.Function;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.stereotype.Service;

/**
 * The open-source subject: the account fields of the anonymous user, and no custom attributes.
 *
 * <p>The enterprise edition replaces this bean with one that also reads the member's custom permission
 * attributes in the current domain.</p>
 */
@Service
@ConditionalOnMissingBean(SubjectAttributeLookup.class)
public class DefaultSubjectAttributeLookup implements SubjectAttributeLookup {

    private static final Map<String, Function<User, String>> ACCOUNT_FIELDS =
            Map.of(
                    "id", User::getId,
                    "loginCode", User::getLoginCode,
                    "userName", User::getUserName,
                    "domainId", User::getDomainId);

    /** The account fields a rule may reference, in display order. */
    public static java.util.List<String> accountFieldNames() {
        return java.util.List.of("id", "loginCode", "userName", "domainId");
    }

    @Override
    public Object attribute(User user, String source, String attribute) {
        if (user == null || attribute == null) return null;
        if (!ACCOUNT.equals(source)) return null;
        Function<User, String> field = ACCOUNT_FIELDS.get(attribute);
        return field == null ? null : field.apply(user);
    }
}
