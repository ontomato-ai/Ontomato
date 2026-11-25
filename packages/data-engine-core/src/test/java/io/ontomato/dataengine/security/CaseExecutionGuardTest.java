package io.ontomato.dataengine.security;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.authorization.ActionAuthorization.Denied;
import io.ontomato.dataengine.service.authorization.AuthorizationService.Standalone;
import io.ontomato.dataengine.service.authorization.AuthorizationService.WorkflowStep;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

class CaseExecutionGuardTest {
    @Test
    void verifiesTheDomainActorStepTargetAndParametersBeforeCreatingWorkflowContext() throws Exception {
        String key = "test-key";
        var guard = new CaseExecutionGuard(key);
        var actor = mock(User.class);
        when(actor.getDomainId()).thenReturn("domain");
        when(actor.getLoginCode()).thenReturn("alice");
        var request = new MockHttpServletRequest();
        String params = """
                {"target":"invoice:7","approved":true}
                """;
        assertInstanceOf(Standalone.class, guard.resolve(request, "approve", params, actor));
        String target = Base64.getUrlEncoder().withoutPadding()
                .encodeToString("[\"Invoice\",\"invoice:7\"]".getBytes(UTF_8));
        String proof = "run:workflow:3:2:" + (System.currentTimeMillis() + 10000) + ":" + target;
        var mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key.getBytes(UTF_8), "HmacSHA256"));
        String signature = Base64.getUrlEncoder().withoutPadding()
                .encodeToString(mac.doFinal(String.join("\n", proof, "domain", "alice", "approve", params).getBytes(UTF_8)));
        request.addHeader("X-Ontomato-Case-Run", proof);
        assertThrows(Denied.class, () -> guard.resolve(request, "approve", params, actor));
        request.addHeader("X-Ontomato-Case-Signature", signature);
        assertEquals(new WorkflowStep("workflow", 3, 2, "run", "Invoice", "invoice:7"),
                guard.resolve(request, "approve", params, actor));
        assertThrows(Denied.class, () -> guard.resolve(request, "approve", "{}", actor));
        assertThrows(Denied.class, () -> guard.resolve(request, "reject", params, actor));
        when(actor.getDomainId()).thenReturn("other-domain");
        assertThrows(Denied.class, () -> guard.resolve(request, "approve", params, actor));
    }
}
