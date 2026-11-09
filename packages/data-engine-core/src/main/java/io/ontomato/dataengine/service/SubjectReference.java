package io.ontomato.dataengine.service;

/**
 * The one syntax for "a value the server fills in from the caller's identity".
 *
 * <p>A query definition may compare against the acting subject — "assigned to me", "my department" —
 * without the caller being able to supply that value. The reference is written where the value goes
 * ({@code {{account.id}}}) and resolved by the server from the authenticated request.</p>
 *
 * <p>Parsing lives here rather than in each consumer because the rule decides whether a call is
 * <em>filtered by the subject</em> or <em>matched against a literal</em>. Two slightly different
 * parsers would eventually disagree about one spelling, and the disagreement would be a silent
 * authorization-shaped bug: a reference read as a literal simply matches nothing, while a template
 * read as a reference quietly becomes "whoever is calling".</p>
 */
public final class SubjectReference {

    /** One parsed {@code {{source.attribute}}}. */
    public record Parsed(String source, String attribute) {}

    private SubjectReference() {}

    /**
     * Parse a whole value as one reference, or null when it is not one.
     *
     * <p>Only a value that is <em>exactly</em> a reference counts. A reference embedded in longer text
     * is a template, and comparing a template is never what "only mine" means, so it stays literal.</p>
     */
    public static Parsed parse(String text) {
        if (text == null || !text.startsWith("{{") || !text.endsWith("}}")) return null;
        String body = text.substring(2, text.length() - 2);
        if (body.contains("{{") || body.contains("}}")) return null;
        int dot = body.indexOf('.');
        if (dot <= 0 || dot >= body.length() - 1) return null;
        String source = body.substring(0, dot).trim();
        String attribute = body.substring(dot + 1).trim();
        if (source.isEmpty() || attribute.isEmpty()) return null;
        return new Parsed(source, attribute);
    }

    /**
     * Whether a value is written as a reference at all, well formed or not, so a typo can be reported.
     *
     * <p>Either delimiter is enough: a value starting with {@code {{} or ending with {@code }}} was
     * almost certainly meant as a reference, and treating a broken one as a literal is exactly the
     * silent "matches nothing" failure this check exists to catch.</p>
     */
    public static boolean writtenAsReference(String text) {
        return text != null && (text.startsWith("{{") || text.endsWith("}}"));
    }
}
