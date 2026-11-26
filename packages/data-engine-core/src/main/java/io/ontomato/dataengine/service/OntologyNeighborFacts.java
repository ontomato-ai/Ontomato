package io.ontomato.dataengine.service;

import java.util.List;

/** Edges scoped to one ontology center and the owner names visible for their endpoints. */
public record OntologyNeighborFacts(List<Link> links, List<Name> fromNames, List<Name> toNames) {
    // ECMAScript String.trim whitespace, used for IDs read from persisted definitions.
    public static final String ID_PADDING =
            "\t\n\u000B\f\r \u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A"
            + "\u2028\u2029\u202F\u205F\u3000\uFEFF";

    public record Link(String fromId, String toId) {}

    public record Name(String id, String name, String loginCode, String detail) {
        public Name(String id, String name, String loginCode) {
            this(id, name, loginCode, null);
        }
    }
}
