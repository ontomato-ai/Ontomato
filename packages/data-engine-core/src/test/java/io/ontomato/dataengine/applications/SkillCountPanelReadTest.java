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

    @Test void deleteAccessAnswersTheChangeDecisionWithoutRefusingTheRead() {
        var authorization = mock(AuthorizationService.class);
        var denied = new Decision(false, "MANAGEMENT_FORBIDDEN", "Change refused");
        when(authorization.decide(subject, new Management("skills.library.change"))).thenReturn(denied);
        var delete = new SkillCountPanelRead().skillDeleteAccess(authorization);

        assertSame(denied, delete.handler().read(subject, Map.of()));
        verify(authorization, never()).decide(subject, new Management("skills.library.read"));
    }
}
