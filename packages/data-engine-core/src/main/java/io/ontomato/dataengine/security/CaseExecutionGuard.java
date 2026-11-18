package io.ontomato.dataengine.security;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import io.ontomato.dataengine.core.bean.User;
import jakarta.servlet.http.HttpServletRequest;

/**
 * A short-lived, signed assertion from Ontopraxis that a Case step already authorized this actor
 * to run this Action. It is the bridge between Case-scoped workflow authorization and the
 * Action's own role grant: the Action is allowed for exactly one request, for one actor, and only
 * while the assertion is unexpired.
 *
 * <p>The signature is HMAC-SHA256 over runId, actor, actionId and expiry. A bare header would be
 * forgeable by any caller; the shared key is what makes the assertion a service statement.</p>
 */
@Component
public class CaseExecutionGuard {
    private static final String RUN = "X-Ontomato-Case-Run";
    private static final String ACTOR = "X-Ontomato-Case-Actor";
    private static final String ACTION = "X-Ontomato-Case-Action";
    private static final String EXPIRES = "X-Ontomato-Case-Expires";
    private static final String SIGNATURE = "X-Ontomato-Case-Signature";

    private static final ThreadLocal<String> AUTHORIZED_ACTION = new ThreadLocal<>();

    private final String signingKey;

    public CaseExecutionGuard(@Value("${ONTOMATO_CASE_SIGNING_KEY:}") String signingKey) {
        this.signingKey = signingKey;
    }

    /** Verify the assertion and, only on success, open the one-request Action gate. */
    public boolean verify(HttpServletRequest request, String actionId, User user) {
        if (signingKey == null || signingKey.isBlank()) return false;
        String runId = request.getHeader(RUN);
        String actor = request.getHeader(ACTOR);
        String action = request.getHeader(ACTION);
        String expires = request.getHeader(EXPIRES);
        String signature = request.getHeader(SIGNATURE);
        if (runId == null || actor == null || action == null || expires == null || signature == null) return false;
        if (!action.equals(actionId) || user == null || !actor.equals(user.getLoginCode())) return false;
        long expiry;
        try {
            expiry = Long.parseLong(expires);
        } catch (NumberFormatException invalid) {
            return false;
        }
        if (expiry < System.currentTimeMillis()) return false;
        String expected = sign(runId + "\n" + actor + "\n" + actionId + "\n" + expires);
        if (expected == null
                || !MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),
                        signature.getBytes(StandardCharsets.UTF_8))) return false;
        AUTHORIZED_ACTION.set(actionId);
        return true;
    }

    private String sign(String payload) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(signingKey.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return Base64.getUrlEncoder().withoutPadding()
                    .encodeToString(mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.GeneralSecurityException error) {
            return null;
        }
    }

    /** True only inside the request whose signed assertion named this Action. */
    public static boolean allows(String actionId) {
        return actionId != null && actionId.equals(AUTHORIZED_ACTION.get());
    }

    public void clear() {
        AUTHORIZED_ACTION.remove();
    }
}
