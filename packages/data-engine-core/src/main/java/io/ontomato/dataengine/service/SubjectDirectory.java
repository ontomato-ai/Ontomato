package io.ontomato.dataengine.service;

import java.util.List;
import java.util.Set;

/**
 * The subjects who can act in a domain, and the roles each one actually holds.
 *
 * <p>Provenance columns store a subject id — that is what must be durable — but an operator reading
 * "who approved this" needs a name. Resolving it at render time keeps the stored value honest: a renamed
 * account shows its current name rather than the one it had when the row was written.</p>
 *
 * <p>Roles are reported as the <em>effective</em> set, so organization and position grants are folded in
 * exactly as authorization folds them. Reporting only direct membership would draw a graph that
 * disagrees with what the executor actually permits.</p>
 *
 * <p>The open-source edition has no accounts and answers with an empty list.</p>
 */
public interface SubjectDirectory {

    /** One subject of the domain and the roles in effect for them here. */
    record Subject(String id, String loginCode, String displayName, Set<String> roleIds) {}

    List<Subject> subjectsInDomain(String domainId);
}
