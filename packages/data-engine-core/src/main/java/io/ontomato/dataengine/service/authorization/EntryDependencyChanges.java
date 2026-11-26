package io.ontomato.dataengine.service.authorization;

import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;

import io.ontomato.dataengine.applications.ApplicationCatalog;
import io.ontomato.dataengine.bean.workflow.GrantScope;
import io.ontomato.dataengine.migration.DataEngineMigration;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

@Service
public final class EntryDependencyChanges implements DataEngineMigration {
    public record Source(String kind, String sequence, String actorId) {}
    public record Dependency(Kind objectType, String objectKey, Verb verb, GrantScope scope) {}
    public record EntryChange(String entryId, List<Dependency> before, List<Dependency> after) {}
    public record Publication(String domainId, Source source, List<EntryChange> entries) {}

    private final AuthorizationStore store;
    private final ApplicationCatalog applications;
    private final TransactionTemplate transactions;
    private final JdbcTemplate jdbc;

    public EntryDependencyChanges(AuthorizationStore store, ApplicationCatalog applications,
                                  TransactionTemplate transactions, JdbcTemplate jdbc) {
        this.store = store;
        this.applications = applications;
        this.transactions = transactions;
        this.jdbc = jdbc;
    }

    @Override
    public String id() {
        return "20261126-entry-dependency-publication-cursor";
    }

    @Override
    public void run() {
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS entry_dependency_publication_cursor (
                domain_id text NOT NULL,
                source text NOT NULL,
                sequence bigint NOT NULL,
                PRIMARY KEY (domain_id, source)
            )
            """);
    }

    public void apply(Publication publication) {
        if (publication.domainId() == null || publication.domainId().isBlank()
                || publication.source() == null || publication.entries() == null)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "A domain, source and entry changes are required");
        if (publication.source().kind() == null
                || !Set.of("panel", "application", "object-detail").contains(publication.source().kind())
                || publication.source().sequence() == null || !publication.source().sequence().matches("[1-9][0-9]*")
                || publication.source().actorId() == null || publication.source().actorId().isBlank())
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid entry dependency source");

        var sequence = publicationSequence(publication.source().sequence());
        transactions.executeWithoutResult(ignored -> {
            // The workbench commits its cursor after this transaction. Replayed events must
            // not recreate a proposal that an administrator has already handled.
            int advanced = jdbc.update("""
                INSERT INTO entry_dependency_publication_cursor AS cursor (domain_id, source, sequence)
                VALUES (?, ?, ?)
                ON CONFLICT (domain_id, source) DO UPDATE SET sequence = EXCLUDED.sequence
                WHERE cursor.sequence < EXCLUDED.sequence
                """, publication.domainId(), publication.source().kind(), sequence);
            if (advanced == 0) return;
            for (var entry : publication.entries()) apply(publication.domainId(), publication.source(), entry);
        });
    }

    private static long publicationSequence(String value) {
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException error) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid entry dependency change sequence", error);
        }
    }

    private void apply(String domainId, Source source, EntryChange change) {
        if (change.entryId() == null || change.entryId().isBlank() || change.before() == null || change.after() == null)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid entry dependency change");
        if (change.before().isEmpty() && change.after().isEmpty() && !"application".equals(source.kind()))
            return;
        var entry = new ObjectTarget(domainId, Kind.ENTRY, change.entryId());
        var affectedPolicies = store.entryPolicies(entry);
        var removed = difference(change.before(), change.after());
        if ("application".equals(source.kind())) {
            var current = Set.copyOf(change.after());
            for (var policy : affectedPolicies) {
                for (var pending : store.pendingGrants(domainId, policy)) {
                    if (!entry.equals(pending.entry()) || pending.grant().target().kind() == Kind.ENTRY) continue;
                    var grant = pending.grant();
                    var dependency = new Dependency(grant.target().kind(), grant.target().id(), grant.verb(), grant.scope());
                    if (!current.contains(dependency)) removed.add(dependency);
                }
            }
        }
        closeRemoved(entry, removed);
        if (!change.entryId().startsWith("object-detail:") && !applications.ownsEntry(domainId, change.entryId())) {
            store.closePendingGrants(entry, entry, Verb.ENTER, null);
            return;
        }
        for (var added : difference(change.after(), change.before())) {
            AuthorizationPolicies.requireGrant(added.objectType(), added.objectKey(), added.verb(), added.scope(), true);
            var target = new ObjectTarget(domainId, added.objectType(), added.objectKey());
            for (var policy : affectedPolicies) {
                if (store.objectGrants(target, added.verb(), Set.of(policy)).stream()
                        .anyMatch(grant -> java.util.Objects.equals(grant.scope(), added.scope()))) continue;
                var grant = new ObjectGrant(policy, target, added.verb(), added.scope());
                store.addPendingGrant(new PendingGrant(0, source.kind(), source.sequence(), source.actorId(), entry, grant));
            }
        }
    }

    private void closeRemoved(ObjectTarget entry, Set<Dependency> dependencies) {
        for (var removed : dependencies) {
            AuthorizationPolicies.requireGrant(removed.objectType(), removed.objectKey(), removed.verb(), removed.scope(), true);
            store.closePendingGrants(entry, new ObjectTarget(entry.domainId(), removed.objectType(), removed.objectKey()),
                    removed.verb(), removed.scope());
        }
    }

    private static Set<Dependency> difference(List<Dependency> after, List<Dependency> before) {
        var result = new LinkedHashSet<>(after);
        result.removeAll(new LinkedHashSet<>(before));
        return result;
    }
}
