package io.ontomato.dataengine.config;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import io.ontomato.dataengine.dataAdapter.SecretCipher;

/**
 * Saved model keys reach the workbench and agent runtime sealed: the model settings read shows masks
 * ({@link ModelKeyMask}) and carries each model's keys encrypted with a key that all three services
 * derive from the same {@code ONTOMATO_MODEL_RUNTIME_TOKEN} (AES-256-GCM, the {@link SecretCipher}
 * {@code enc:v1:} format, key = SHA-256 of the value). A browser sees only masks and ciphertext.
 * The same rule holds in every edition; a missing or blank value stops the data engine at startup.
 */
@Component
public class ModelKeySeal {

    public static final String TOKEN_ENV = "ONTOMATO_MODEL_RUNTIME_TOKEN";

    private final SecretCipher cipher;

    public ModelKeySeal(@Value("${" + TOKEN_ENV + ":}") String token) {
        if (token == null || token.isBlank()) {
            throw new IllegalStateException(TOKEN_ENV
                    + " is not set: the data engine, workbench server and agent runtime must use the same value");
        }
        this.cipher = new SecretCipher(Base64.getEncoder().encodeToString(sha256(token)), SecretCipher.Mode.DUAL);
    }

    /** Each key encrypted for the Node consumers; a missing list seals to an empty one. */
    public List<String> seal(List<String> keys) {
        List<String> sealed = new ArrayList<>();
        if (keys != null) {
            for (String key : keys) {
                sealed.add(cipher.encrypt(key));
            }
        }
        return sealed;
    }

    private static byte[] sha256(String value) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
