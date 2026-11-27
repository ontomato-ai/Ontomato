package io.ontomato.dataengine.service.authorization;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import io.ontomato.dataengine.applications.ApplicationCatalog;
import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;

import java.util.Set;
import java.util.List;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;

class EntryDependencyChangesTest {
    @Test
    void dependencyPublicationsStillUseTheExistingCursorAndDoNotReplay() {
        var applications = mock(ApplicationCatalog.class);
        var store = mock(AuthorizationStore.class);
        var jdbc = mock(JdbcTemplate.class);
        var transactions = mock(TransactionTemplate.class);
        doAnswer(invocation -> {
            invocation.<Consumer<TransactionStatus>>getArgument(0).accept(mock(TransactionStatus.class));
            return null;
        }).when(transactions).executeWithoutResult(any());
        var changes = new EntryDependencyChanges(store, applications, transactions, jdbc);
        var entry = new ObjectTarget("domain", Kind.ENTRY, "app/use");
        when(applications.ownsEntry("domain", "app/use")).thenReturn(true);
        when(store.entryPolicies(entry)).thenReturn(Set.of("policy"));
        when(jdbc.update(contains("entry_dependency_publication_cursor"), eq("domain"), eq("panel"), eq(1L)))
            .thenReturn(1, 0);
        var dependency = new EntryDependencyChanges.Dependency(Kind.PROJECTION, "projection", Verb.USE, null);
        var publication = publication("domain", "1", "app/use", dependency);
        changes.apply(publication);
        changes.apply(publication);

        verify(store).entryPolicies(entry);
        verify(store).addPendingGrant(any());
        verify(applications).ownsEntry("domain", "app/use");

    }

    private static EntryDependencyChanges.Publication publication(String domain, String sequence, String entryId, EntryDependencyChanges.Dependency dependency) {
        return new EntryDependencyChanges.Publication(domain, new EntryDependencyChanges.Source("panel", sequence, "author"),
            List.of(new EntryDependencyChanges.EntryChange(entryId, List.of(), List.of(dependency))));
    }
}
