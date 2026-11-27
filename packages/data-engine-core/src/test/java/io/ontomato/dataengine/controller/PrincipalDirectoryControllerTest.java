package io.ontomato.dataengine.controller;

import static io.ontomato.dataengine.service.authorization.AuthorizationService.*;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.ontomato.dataengine.service.IdentityPrincipalDirectory;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.RoleResolution;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

class PrincipalDirectoryControllerTest {
    @Test
    void workbenchReadResolvesAllCandidateIdsAndUsesTheOriginalMemberSearch() {
        var identity = mock(IdentityService.class);
        var directory = mock(IdentityPrincipalDirectory.class);
        var handler = new PrincipalDirectoryController(identity, directory).principalDirectoryPanelRead(new ObjectMapper()).handler();
        var subject = new SubjectContext(new VerifiedIdentity("domain", "reader", CredentialLimit.UNRESTRICTED),
                new RoleResolution(Set.of(), Set.of(), List.of(), Set.of(), Map.of(), false), Map.of(), Set.of(), Set.of());
        var ids = IntStream.range(0, 125).mapToObj(index -> "author-" + index).toList();
        var submitted = new java.util.ArrayList<>(ids);
        submitted.add(ids.getFirst());
        var last = ids.getLast();
        when(directory.principalNames("domain", ids)).thenReturn(Map.of(last, "Ada", "different-id", "Hidden"));
        when(directory.searchPrincipals("domain", "Ada", 100))
                .thenReturn(List.of(new IdentityPrincipalDirectory.PrincipalOption(last, "Ada")));
        var expected = new PrincipalDirectoryController.DirectoryResult(
                List.of(new PrincipalDirectoryController.DirectoryEntry(last, "Ada", "member")));

        assertEquals(expected, handler.read(subject, Map.of("kind", "member", "ids", submitted)));
        assertEquals(expected, handler.read(subject, Map.of("kind", "member", "keyword", " Ada ", "limit", 100)));
        verify(directory).principalNames("domain", ids);
        verify(directory).searchPrincipals("domain", "Ada", 100);
        verifyNoMoreInteractions(directory);
        verifyNoInteractions(identity);
    }
}
