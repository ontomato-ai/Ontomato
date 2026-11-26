package io.ontomato.dataengine.applications;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.authorization.AuthorizationService;
import io.ontomato.dataengine.service.authorization.AuthorizationService.*;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.Verb;
import java.util.Map;
import java.util.Objects;
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
        when(authorization.decide(any(), any(ObjectAccess.class))).thenReturn(new Decision(false, "OBJECT_FORBIDDEN", "Edit denied"));
        return authorization;
    }

    static void allowEdit(AuthorizationService authorization, User user, JSONObject app) {
        doReturn(new Decision(true, null, null)).when(authorization).decide(
            argThat(ctx -> Objects.equals(user.getId(), ctx.identity().userId())),
            argThat(request -> request instanceof ObjectAccess access && access.verb() == Verb.EDIT
                && (app == null || ApplicationCatalog.applicationTarget(app).equals(access.target()))));
    }
}
