package io.ontomato.dataengine.service.authorization;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import io.ontomato.dataengine.service.authorization.AuthorizationService.CredentialLimit;
import io.ontomato.dataengine.service.authorization.AuthorizationService.SubjectContext;
import io.ontomato.dataengine.service.authorization.AuthorizationService.VerifiedIdentity;
import java.util.Map;
import java.util.Set;

public final class CapabilityDefinitionTestSupport {
    private CapabilityDefinitionTestSupport() {}

    public static CapabilityDefinitions allowedDefinitions(String domain, String actor) {
        var definitions = mock(CapabilityDefinitions.class);
        when(definitions.current()).thenReturn(subject(domain, actor));
        when(definitions.subject(any())).thenAnswer(call -> {
            io.ontomato.dataengine.core.bean.User user = call.getArgument(0);
            return subject(user.getDomainId(), user.getId());
        });
        when(definitions.allows(any(), any())).thenReturn(true);
        when(definitions.canRead(any(), any())).thenReturn(true);
        return definitions;
    }

    private static SubjectContext subject(String domain, String actor) {
        return new SubjectContext(new VerifiedIdentity(domain, actor, CredentialLimit.UNRESTRICTED), null,
                Map.of(), Set.of(), Set.of());
    }
}
