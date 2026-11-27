package io.ontomato.dataengine.controller;

import static io.ontomato.dataengine.service.authorization.AuthorizationService.*;
import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.*;

import io.ontomato.dataengine.applications.ApplicationCatalog;
import io.ontomato.dataengine.service.authorization.AuthorizationStore;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

class OntologyApplicationSearchFactsTest {
    @Test
    void readsDomainUseKeysOnlyForTheRequestedProductKind() {
        var store = mock(AuthorizationStore.class);
        var subject = mock(SubjectContext.class);
        when(subject.identity()).thenReturn(new VerifiedIdentity("domain-a", "reader", CredentialLimit.UNRESTRICTED));
        when(store.domainPolicy("domain-a")).thenReturn(new PolicyRef(null, "domain-policy", PolicyKind.OBJECT));
        when(store.objectKeysByVerb("domain-a", Kind.PANEL, Set.of(Verb.USE), Set.of("domain-policy")))
            .thenReturn(Map.of(Verb.USE, Set.of("panel-a")));
        when(store.objectKeysByVerb("domain-a", Kind.AGENT, Set.of(Verb.USE), Set.of("domain-policy")))
            .thenReturn(Map.of());
        var controller = new AuthorizationPolicyGovernanceController(null, null, null, null, null,
            null, null, store, null, null, null);
        var read = controller.ontologyDomainSharedProducts().handler();
        assertEquals(Set.of("panel-a"), read.read(subject, Map.of("kind", "PANEL")));
        assertEquals(Set.of(), read.read(subject, Map.of("kind", "AGENT")));
        assertThrows(org.springframework.web.server.ResponseStatusException.class,
            () -> read.read(subject, Map.of("kind", "PROJECTION")));
        verify(store, times(2)).domainPolicy("domain-a");
        verify(store).objectKeysByVerb("domain-a", Kind.PANEL, Set.of(Verb.USE), Set.of("domain-policy"));
        verify(store).objectKeysByVerb("domain-a", Kind.AGENT, Set.of(Verb.USE), Set.of("domain-policy"));
        verifyNoMoreInteractions(store);
    }

    @Test
    void readsOnlyDomainEnterGrantsForTheSubjectsVisibleEntries() throws Exception {
        var catalog = mock(ApplicationCatalog.class);
        var store = mock(AuthorizationStore.class);
        var subject = mock(SubjectContext.class);
        String domain = "domain-a";
        String policyId = "domain-policy";
        when(subject.identity()).thenReturn(new VerifiedIdentity(domain, "reader", CredentialLimit.UNRESTRICTED));
        when(catalog.visibleEntries(subject)).thenReturn(List.of(
            new ApplicationCatalog.VisibleEntry("ontology/overview", "ontology", Map.of(), "overview"),
            new ApplicationCatalog.VisibleEntry("private-app/readable", "private-app", Map.of(), "readable")
        ));
        var shared = new ObjectTarget(domain, Kind.ENTRY, "ontology/overview");
        var privateEntry = new ObjectTarget(domain, Kind.ENTRY, "private-app/readable");
        when(store.domainPolicy(domain)).thenReturn(new PolicyRef(null, policyId, PolicyKind.OBJECT));
        when(store.objectGrants(shared, Verb.ENTER, Set.of(policyId)))
            .thenReturn(List.of(new ObjectGrant(policyId, shared, Verb.ENTER, null)));

        var controller = new AuthorizationPolicyGovernanceController(null, null, null, null, null,
            catalog, null, store, null, null, null);
        assertEquals(Set.of("ontology"), controller.ontologyDomainSharedApplications().handler().read(subject, Map.of()));
        verify(catalog).visibleEntries(subject);
        verify(store).domainPolicy(domain);
        verify(store).objectGrants(shared, Verb.ENTER, Set.of(policyId));
        verify(store).objectGrants(privateEntry, Verb.ENTER, Set.of(policyId));
        verifyNoMoreInteractions(store, catalog);
    }

    @Test
    void restrictsSharedApplicationAndPanelFactsToRequestedEndpoints() {
        var catalog = mock(ApplicationCatalog.class);
        var store = mock(AuthorizationStore.class);
        var subject = mock(SubjectContext.class);
        var domain = "domain-a";
        var policy = "domain-policy";
        when(subject.identity()).thenReturn(new VerifiedIdentity(domain, "reader", CredentialLimit.UNRESTRICTED));
        when(store.domainPolicy(domain)).thenReturn(new PolicyRef(null, policy, PolicyKind.OBJECT));
        when(catalog.visibleEntries(subject, Set.of("shared", "hidden"))).thenReturn(List.of(
                new ApplicationCatalog.VisibleEntry("shared/entry", "shared", Map.of(), "entry")));
        var entry = new ObjectTarget(domain, Kind.ENTRY, "shared/entry");
        var panel = new ObjectTarget(domain, Kind.PANEL, "panel-a");
        when(store.objectGrants(entry, Verb.ENTER, Set.of(policy)))
            .thenReturn(List.of(new ObjectGrant(policy, entry, Verb.ENTER, null)));
        when(store.objectGrants(panel, Verb.USE, Set.of(policy)))
            .thenReturn(List.of(new ObjectGrant(policy, panel, Verb.USE, null)));

        var controller = new AuthorizationPolicyGovernanceController(null, null, null, null, null,
            catalog, null, store, null, null, null);
        assertEquals(Set.of("shared"), controller.ontologyDomainSharedApplications().handler()
            .read(subject, Map.of("ids", List.of("hidden", "shared"))));
        assertEquals(Set.of("panel-a"), controller.ontologyDomainSharedProducts().handler()
            .read(subject, Map.of("kind", "PANEL", "ids", List.of("panel-a", "panel-b"))));
        verify(catalog).visibleEntries(subject, Set.of("shared", "hidden"));
        verify(store, times(2)).domainPolicy(domain);
        verify(store).objectGrants(entry, Verb.ENTER, Set.of(policy));
        verify(store).objectGrants(panel, Verb.USE, Set.of(policy));
        verify(store).objectGrants(new ObjectTarget(domain, Kind.PANEL, "panel-b"), Verb.USE, Set.of(policy));
        verifyNoMoreInteractions(store, catalog);
    }
}
