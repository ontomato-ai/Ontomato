package io.ontomato.dataengine.applications;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import io.ontomato.dataengine.service.authorization.AuthorizationService;
import io.ontomato.dataengine.service.authorization.AuthorizationService.*;
import java.util.Map;
import java.util.Set;
import java.util.function.BiPredicate;

final class EntryAuthorizationFixture {
    private EntryAuthorizationFixture() {}

    static AuthorizationService allowEntries() {
        return entries((actor, entry) -> true);
    }

    static AuthorizationService entries(BiPredicate<VerifiedIdentity, String> allowed) {
        var authorization = mock(AuthorizationService.class);
        when(authorization.resolveSubject(any())).thenAnswer(call ->
            new SubjectContext(call.getArgument(0), null, Map.of(), Set.of(), Set.of()));
        when(authorization.decide(any(), any(Entry.class))).thenAnswer(call -> {
            SubjectContext subject = call.getArgument(0);
            Entry entry = call.getArgument(1);
            boolean admitted = subject.identity().limit().permits(entry)
                && subject.identity().domainId().equals(entry.target().domainId())
                && allowed.test(subject.identity(), entry.target().id());
            return new Decision(admitted, admitted ? null : "ENTRY_FORBIDDEN", admitted ? null : "Entry denied");
        });
        return authorization;
    }
}
