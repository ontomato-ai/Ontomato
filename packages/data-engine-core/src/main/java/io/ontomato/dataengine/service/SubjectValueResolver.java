package io.ontomato.dataengine.service;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.core.bean.User;

/**
 * Fills subject references in a declared value with what the server knows about the caller.
 *
 * <p>This is the half of the contract that must not be negotiable. A query author decides <em>what</em>
 * is compared ("the assignee is the caller"); the value itself is read from the authenticated request,
 * never from the caller's parameters. That split is what makes "my pending items" mean mine even when
 * the caller passes someone else's id: the predicate is authored, the value is not.</p>
 *
 * <p>Resolution fails closed. A reference that cannot be resolved refuses the run instead of becoming
 * null, because null in a comparison silently matches nothing — which reads to an operator as "you have
 * no pending items", the exact wrong answer this mechanism exists to prevent.</p>
 */
@Component
public class SubjectValueResolver {

    /** The sources a reference may name. */
    public static final String ACCOUNT = SubjectAttributeLookup.ACCOUNT;
    public static final String PRINCIPAL = SubjectAttributeLookup.PRINCIPAL;

    private static final Set<String> SOURCES = Set.of(ACCOUNT, PRINCIPAL);

    private final SubjectAttributeLookup subjects;

    public SubjectValueResolver(SubjectAttributeLookup subjects) {
        this.subjects = subjects;
    }

    /** Resolve every value of a parameter map, returning a new map; the stored definition is not touched. */
    public JSONObject resolveValues(JSONObject values, User user) {
        if (values == null) return new JSONObject();
        JSONObject resolved = new JSONObject();
        for (String name : values.keySet()) {
            resolved.put(name, resolve(values.get(name), user));
        }
        return resolved;
    }

    /**
     * Resolve one declared value.
     *
     * <p>Literals pass through untouched; a reference must produce exactly one value. A multi-valued
     * subject attribute (a custom attribute holding several strings) cannot stand in for a scalar
     * comparison, so it is refused rather than silently joined into something the author did not write.</p>
     */
    public Object resolve(Object value, User user) {
        if (value instanceof String text) {
            SubjectReference.Parsed reference = SubjectReference.parse(text);
            return reference == null ? text : resolve(reference, text, user);
        }
        if (value instanceof List<?> items) {
            List<Object> resolved = new ArrayList<>(items.size());
            for (Object item : items) resolved.add(resolve(item, user));
            return JSONArray.of(resolved.toArray());
        }
        return value;
    }

    /**
     * Check the shape of a declared value at publish time, so a misspelt reference is refused while the
     * author is still looking at the definition rather than at execution time when it reads as "no data".
     */
    public void validate(Object value) {
        if (value instanceof String text) {
            if (!SubjectReference.writtenAsReference(text)) return;
            SubjectReference.Parsed reference = SubjectReference.parse(text);
            if (reference == null) {
                throw new IllegalArgumentException(
                        "Malformed subject reference: " + text + " (expected {{account.field}} or {{principal.attribute}})");
            }
            requireKnownSource(reference, text);
            requireKnownAccountField(reference, text);
            return;
        }
        if (value instanceof List<?> items) {
            for (Object item : items) validate(item);
        }
    }

    /** Validate every value of a parameter map. */
    public void validateValues(JSONObject values) {
        if (values == null) return;
        for (String name : values.keySet()) {
            try {
                validate(values.get(name));
            } catch (IllegalArgumentException error) {
                throw new IllegalArgumentException("Parameter '" + name + "': " + error.getMessage(), error);
            }
        }
    }

    private Object resolve(SubjectReference.Parsed reference, String text, User user) {
        requireKnownSource(reference, text);
        requireKnownAccountField(reference, text);
        Object value = subjects.attribute(user, reference.source(), reference.attribute());
        if (value == null) {
            throw new IllegalArgumentException(
                    "Subject reference " + text + " could not be resolved for the current caller;"
                            + " the run is refused rather than matched against nothing");
        }
        if (value instanceof List<?> values) {
            if (values.size() != 1) {
                throw new IllegalArgumentException(
                        "Subject reference " + text + " resolved to " + values.size()
                                + " values; a comparison needs exactly one");
            }
            return values.get(0);
        }
        return value;
    }

    private void requireKnownSource(SubjectReference.Parsed reference, String text) {
        if (!SOURCES.contains(reference.source())) {
            throw new IllegalArgumentException(
                    "Unknown subject source in " + text + "; allowed: " + String.join(", ", SOURCES));
        }
    }

    /**
     * Account field names are edition-specific, so only the edition can check them. An edition that
     * reports no list (a custom implementation) is not second-guessed: execution still fails closed.
     */
    private void requireKnownAccountField(SubjectReference.Parsed reference, String text) {
        if (!ACCOUNT.equals(reference.source())) return;
        List<String> fields = subjects.supportedAccountFields();
        if (fields != null && !fields.isEmpty() && !fields.contains(reference.attribute())) {
            throw new IllegalArgumentException(
                    "Unknown account field in " + text + "; allowed: " + String.join(", ", fields));
        }
    }
}
