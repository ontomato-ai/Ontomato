package io.ontomato.dataengine.service.impl;

import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.SubjectAttributeLookup;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Function;
import org.springframework.stereotype.Component;

/**
 * The open-source subject: the account fields of the anonymous user, and no custom attributes.
 *
 * <p>The enterprise edition provides its own bean, which also reads the member's custom permission
 * attributes in the current domain. Like {@link AnonymousDataPermissionLookup}, this belongs to the
 * open-source application rather than to the shared core: OSS and enterprise each assemble exactly one
 * implementation, instead of relying on component scan order to replace a default.</p>
 */
@Component
public class AnonymousSubjectAttributeLookup implements SubjectAttributeLookup {

    /** The account fields a rule may reference, in display order. Credentials are not offered. */
    static final Map<String, Function<User, String>> ACCOUNT_FIELDS = accountFields();

    private static Map<String, Function<User, String>> accountFields() {
        Map<String, Function<User, String>> fields = new LinkedHashMap<>();
        fields.put("id", User::getId);
        fields.put("loginCode", User::getLoginCode);
        fields.put("userName", User::getUserName);
        fields.put("domainId", User::getDomainId);
        return fields;
    }

    /** The account field names this edition offers, in display order. */
    public static java.util.List<String> accountFieldNames() {
        return java.util.List.copyOf(ACCOUNT_FIELDS.keySet());
    }

    @Override
    public Object attribute(User user, String source, String attribute) {
        if (user == null || attribute == null || !ACCOUNT.equals(source)) return null;
        Function<User, String> field = ACCOUNT_FIELDS.get(attribute);
        if (field == null) return null;
        String value = field.apply(user);
        return value == null || value.isBlank() ? null : value.trim();
    }
}
