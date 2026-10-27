package io.ontomato.dataengine.dataAdapter;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Locale;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import lombok.extern.slf4j.Slf4j;

/**
 * Encrypts/decrypts connection secrets at the persistence boundary.
 *
 * <p>Values written by this class carry an {@code enc:v1:} prefix, so a reader
 * can tell ciphertext from legacy plaintext without a migration. The key comes
 * from {@code ontomato.connection-secrets.key} (base64, 16/24/32 bytes) or the
 * {@code ONTOMATO_CONNECTION_SECRETS_KEY} environment variable. With no key the
 * cipher is disabled and values stay plaintext; {@code mode=enforced} refuses
 * to start without a key and refuses to read a plaintext secret.</p>
 */
@Slf4j
@Component
public class SecretCipher {

	public static final String PREFIX = "enc:v1:";
	private static final int IV_BYTES = 12;
	private static final int TAG_BITS = 128;

	public enum Mode {
		OFF, DUAL, ENFORCED
	}

	private final SecretKeySpec key;
	private final Mode mode;
	private final SecureRandom random = new SecureRandom();

	/** The constructor Spring uses; the other one is for tests and for callers that bring their own key. */
	@Autowired
	public SecretCipher(Environment environment) {
		this(environment.getProperty("ontomato.connection-secrets.key"),
				parseMode(environment.getProperty("ontomato.connection-secrets.mode", "dual")));
	}

	/** Visible for tests: construct with an explicit base64 key and mode. */
	public SecretCipher(String base64Key, Mode requestedMode) {
		Mode requested = requestedMode == null ? Mode.DUAL : requestedMode;
		if (base64Key == null || base64Key.isBlank()) {
			if (requested == Mode.ENFORCED) {
				throw new IllegalStateException(
						"ontomato.connection-secrets.mode=enforced requires ontomato.connection-secrets.key");
			}
			this.key = null;
			this.mode = Mode.OFF;
			log.warn("Connection secret encryption is disabled: ontomato.connection-secrets.key is not configured");
			return;
		}
		byte[] bytes;
		try {
			bytes = Base64.getDecoder().decode(base64Key.trim());
		} catch (IllegalArgumentException e) {
			throw new IllegalStateException("ontomato.connection-secrets.key is not valid base64", e);
		}
		if (bytes.length != 16 && bytes.length != 24 && bytes.length != 32) {
			throw new IllegalStateException(
					"ontomato.connection-secrets.key must decode to 16, 24 or 32 bytes");
		}
		this.key = new SecretKeySpec(bytes, "AES");
		this.mode = requested;
	}

	private static Mode parseMode(String value) {
		try {
			return Mode.valueOf(value.trim().toUpperCase(Locale.ROOT));
		} catch (RuntimeException e) {
			throw new IllegalStateException(
					"ontomato.connection-secrets.mode must be off, dual or enforced", e);
		}
	}

	public boolean isEnabled() {
		return key != null && mode != Mode.OFF;
	}

	public boolean isEnforced() {
		return mode == Mode.ENFORCED;
	}

	public Mode mode() {
		return mode;
	}

	public boolean isEncrypted(String value) {
		return value != null && value.startsWith(PREFIX);
	}

	public String encrypt(String value) {
		if (value == null || value.isEmpty() || !isEnabled() || isEncrypted(value)) {
			return value;
		}
		try {
			byte[] iv = new byte[IV_BYTES];
			random.nextBytes(iv);
			Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
			cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
			byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
			byte[] combined = new byte[iv.length + encrypted.length];
			System.arraycopy(iv, 0, combined, 0, iv.length);
			System.arraycopy(encrypted, 0, combined, iv.length, encrypted.length);
			return PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(combined);
		} catch (GeneralSecurityException e) {
			throw new IllegalStateException("Failed to encrypt a connection secret", e);
		}
	}

	public String decrypt(String value) {
		if (value == null || value.isEmpty()) {
			return value;
		}
		if (!isEncrypted(value)) {
			if (isEnforced()) {
				throw new IllegalStateException(
						"A connection secret is still plaintext; run the connection-secret backfill first");
			}
			return value;
		}
		if (key == null) {
			throw new IllegalStateException(
					"Encrypted connection secret found but ontomato.connection-secrets.key is not configured");
		}
		try {
			byte[] combined = Base64.getUrlDecoder().decode(value.substring(PREFIX.length()));
			if (combined.length <= IV_BYTES) {
				throw new IllegalStateException("Encrypted connection secret is truncated");
			}
			byte[] iv = new byte[IV_BYTES];
			System.arraycopy(combined, 0, iv, 0, IV_BYTES);
			byte[] ciphertext = new byte[combined.length - IV_BYTES];
			System.arraycopy(combined, IV_BYTES, ciphertext, 0, ciphertext.length);
			Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
			cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
			return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
		} catch (GeneralSecurityException | IllegalArgumentException e) {
			throw new IllegalStateException("Failed to decrypt a connection secret", e);
		}
	}
}
