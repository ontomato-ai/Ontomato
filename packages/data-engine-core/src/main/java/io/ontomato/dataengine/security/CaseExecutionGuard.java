package io.ontomato.dataengine.security;

import static java.nio.charset.StandardCharsets.UTF_8;

import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.authorization.ActionAuthorization.Denied;
import io.ontomato.dataengine.service.authorization.AuthorizationService.ActionPath;
import io.ontomato.dataengine.service.authorization.AuthorizationService.Standalone;
import io.ontomato.dataengine.service.authorization.AuthorizationService.WorkflowStep;
import jakarta.servlet.http.HttpServletRequest;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Verifies the existing Praxis assertion, bound to a frozen step and this exact action request. */
@Component
public class CaseExecutionGuard {
    private final String signingKey;

    public CaseExecutionGuard(@Value("${ONTOMATO_CASE_SIGNING_KEY:}") String signingKey) {
        this.signingKey = signingKey;
    }

    public ActionPath resolve(HttpServletRequest request, String actionId, String parameters, User user) {
        String proof = request.getHeader("X-Ontomato-Case-Run");
        String signature = request.getHeader("X-Ontomato-Case-Signature");
        if (proof == null && signature == null) return new Standalone();
        if (proof == null || signature == null || signingKey.isBlank()) throw invalid();
        String[] binding = proof.split(":", -1);
        if (binding.length != 6) throw invalid();
        int version;
        int step;
        long expires;
        try {
            version = Integer.parseInt(binding[2]);
            step = Integer.parseInt(binding[3]);
            expires = Long.parseLong(binding[4]);
        } catch (NumberFormatException invalid) {
            throw invalid();
        }
        if (version < 1 || step < 1 || expires < System.currentTimeMillis()) throw invalid();
        // The target is encoded as JSON inside base64url so the header can carry arbitrary object keys.
        String expected = sign(String.join("\n", proof, user.getDomainId(), user.getLoginCode(), actionId, parameters));
        if (!MessageDigest.isEqual(expected.getBytes(UTF_8), signature.getBytes(UTF_8))) throw invalid();
        var target = com.alibaba.fastjson2.JSON.parseArray(new String(Base64.getUrlDecoder().decode(binding[5]), UTF_8));
        return new WorkflowStep(binding[1], version, step, binding[0], target.getString(0), target.getString(1));
    }

    private String sign(String payload) {
        try {
            var mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(signingKey.getBytes(UTF_8), "HmacSHA256"));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal(payload.getBytes(UTF_8)));
        } catch (GeneralSecurityException error) {
            throw new IllegalStateException(error);
        }
    }

    private static Denied invalid() {
        return new Denied("WORKFLOW_STEP_FORBIDDEN", "The workflow step assertion does not match this execution.");
    }
}
