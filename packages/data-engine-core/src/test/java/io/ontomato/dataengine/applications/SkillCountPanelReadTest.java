package io.ontomato.dataengine.applications;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import io.ontomato.dataengine.service.authorization.AuthorizationService;
import io.ontomato.dataengine.service.authorization.AuthorizationService.*;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class SkillCountPanelReadTest {
    private final SubjectContext subject = new SubjectContext(
        new VerifiedIdentity("domain", "reader", CredentialLimit.UNRESTRICTED), null, Map.of(), Set.of(), Set.of());

    @Test void grantsLibraryCountForTheExistingSubjectWithoutResolvingItAgain() {
        var authorization = mock(AuthorizationService.class);
        when(authorization.decide(subject, new Management("skills.library.read")))
            .thenReturn(new Decision(true, null, null));
        var read = new SkillCountPanelRead().skillCountRead(authorization);
        assertEquals(true, read.handler().read(subject, Map.of()));
        verify(authorization, never()).resolveSubject(any());
    }

    @Test void refusesWithoutReadingSourceFactsWhenSkillLibraryReadIsDenied() {
        var authorization = mock(AuthorizationService.class);
        when(authorization.decide(subject, new Management("skills.library.read")))
            .thenReturn(new Decision(false, "MANAGEMENT_FORBIDDEN", "Denied"));
        var read = new SkillCountPanelRead().skillCountRead(authorization);

        var denied = assertThrows(ResponseStatusException.class, () -> read.handler().read(subject, Map.of()));
        assertEquals(403, denied.getStatusCode().value());
        verify(authorization, never()).resolveSubject(any());
    }

    @Test void deleteDescriptionSharesChangeAdmissionWithoutDenyingLibraryReads() {
        var authorization = mock(AuthorizationService.class);
        var libraryRead = new Management("skills.library.read");
        var libraryChange = new Management("skills.library.change");
        var read = new SkillCountPanelRead().skillLibraryQueryWithDeleteAccess(authorization);
        var delete = new SkillCountPanelRead().skillDeleteAccess(authorization);
        var denied = new Decision(false, "MANAGEMENT_FORBIDDEN", "Change refused");
        when(authorization.decide(subject, libraryRead)).thenReturn(denied, new Decision(true, null, null));
        when(authorization.decide(subject, libraryChange)).thenReturn(denied);

        assertThrows(ResponseStatusException.class, () -> read.handler().read(subject, Map.of()));
        verify(authorization, never()).decide(subject, libraryChange);
        assertSame(denied, read.handler().read(subject, Map.of()));
        assertSame(denied, delete.handler().read(subject, Map.of()));
        verify(authorization, times(2)).decide(subject, libraryChange);
    }

}
