package io.ontomato.dataengine.service.identity;

import io.ontomato.dataengine.schedules.ScheduleException;
import org.springframework.jdbc.core.JdbcTemplate;

import io.ontomato.dataengine.core.bean.User;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UserCredentials {
  private static final SecureRandom RANDOM = new SecureRandom();
  private final JdbcTemplate db;
  private final UserCredentialIdentity identity;
  private final String secret;

  public UserCredentials(
      JdbcTemplate db,
      UserCredentialIdentity identity,
      @Value("${AGENT_RUNTIME_ONTOLOGY_TOKEN:}") String secret) {
    this.db = db;
    this.identity = identity;
    this.secret = secret;
  }

  private static Cipher cipher(int mode, byte[] nonce, String secret)
      throws GeneralSecurityException {
    if (secret.isBlank()) throw new IllegalStateException("Missing ontology runtime credential");
    byte[] key =
        MessageDigest.getInstance("SHA-256")
            .digest(("platform-task-v1\0" + secret).getBytes(StandardCharsets.UTF_8));
    var cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(mode, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce));
    return cipher;
  }

  public static String seal(String key, String secret) {
    if (key == null) return null;
    try {
      byte[] nonce = new byte[12];
      RANDOM.nextBytes(nonce);
      byte[] encrypted =
          cipher(Cipher.ENCRYPT_MODE, nonce, secret).doFinal(key.getBytes(StandardCharsets.UTF_8));
      return Base64.getEncoder()
          .encodeToString(
              java.nio.ByteBuffer.allocate(12 + encrypted.length)
                  .put(nonce)
                  .put(encrypted)
                  .array());
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException(e);
    }
  }

  private String open(String sealed) throws GeneralSecurityException {
    if (sealed == null) return null;
    byte[] bytes = Base64.getDecoder().decode(sealed);
    return new String(
        cipher(Cipher.DECRYPT_MODE, Arrays.copyOf(bytes, 12), secret)
            .doFinal(Arrays.copyOfRange(bytes, 12, bytes.length)),
        StandardCharsets.UTF_8);
  }

  void lockOwner(String domain, String owner) {
    db
        .query(
            "SELECT pg_advisory_xact_lock(hashtextextended(?,0))", r -> {}, domain + "/" + owner);
  }

  @Transactional
  public void prepare(User user, boolean onlyRenew) {
    lockOwner(user.getDomainId(), user.getId());
    var states =
        db
            .queryForList(
                "SELECT valid FROM platform_task_credential WHERE domain_id=? AND creator_id=?",
                Boolean.class,
                user.getDomainId(),
                user.getId());
    if (states.contains(true) || (onlyRenew && (states.isEmpty() || !identity.interactiveLogin())))
      return;
    if (!identity.interactiveLogin())
      throw new ScheduleException(403, "INTERACTIVE_LOGIN_REQUIRED", "A login session is required");
    var sealed = seal(identity.issueKey(user), secret);
    db
        .update(
            """
INSERT INTO platform_task_credential VALUES(?,?,?,true)
ON CONFLICT(domain_id,creator_id) DO UPDATE SET valid=true,sealed_key=EXCLUDED.sealed_key""",
            user.getDomainId(),
            user.getId(),
            sealed);
  }

  /** An explicit administrator save may prepare a missing key; reads never renew one. */
  @Transactional
  public void prepareForExecutionSetting(User user) {
    lockOwner(user.getDomainId(), user.getId());
    var states = db.queryForList(
        "SELECT valid FROM platform_task_credential WHERE domain_id=? AND creator_id=?",
        Boolean.class, user.getDomainId(), user.getId());
    if (states.contains(true)) {
      forOwner(user.getDomainId(), user.getId());
      return;
    }
    var sealed = seal(identity.issueKey(user), secret);
    db.update("""
        INSERT INTO platform_task_credential VALUES(?,?,?,true)
        ON CONFLICT(domain_id,creator_id) DO UPDATE SET valid=true,sealed_key=EXCLUDED.sealed_key
        """, user.getDomainId(), user.getId(), sealed);
  }

  public static class Invalid extends io.ontomato.dataengine.service.agent.AgentHttpException {
    public Invalid() { super(409, "EXECUTION_CREDENTIAL_INVALID", "The user background credential is missing or invalid"); }
  }

  @Transactional
  public void prepareForSetup(User user) {
    prepare(user, false);
    try {
      forOwner(user.getDomainId(), user.getId());
    } catch (Invalid invalid) {
      // A key can have been rotated since the last run; a fresh interactive login can replace it
      // now.
      prepare(user, false);
      forOwner(user.getDomainId(), user.getId());
    }
  }

  public void invalidate(String domain, String creator, String rejectedKey) {
    var rows =
        db
            .queryForList(
                "SELECT sealed_key FROM platform_task_credential WHERE domain_id=? AND creator_id=?"
                    + " AND valid",
                String.class,
                domain,
                creator);
    if (rows.isEmpty()) return;
    String sealed = rows.getFirst();
    try {
      if (!java.util.Objects.equals(open(sealed), rejectedKey)) return;
    } catch (GeneralSecurityException | IllegalArgumentException unreadable) {
      return;
    }
    db
        .update(
            "UPDATE platform_task_credential SET valid=false WHERE domain_id=? AND creator_id=? AND"
                + " sealed_key IS NOT DISTINCT FROM ?",
            domain,
            creator,
            sealed);
  }

  public String forOwner(String domain, String owner) {
    var rows =
        db
            .queryForList(
                "SELECT sealed_key FROM platform_task_credential WHERE domain_id=? AND creator_id=?"
                    + " AND valid",
                String.class,
                domain,
                owner);
    if (rows.isEmpty()) throw new Invalid();
    String sealed = rows.getFirst();
    String key = null;
    boolean readable = true;
    try {
      key = open(sealed);
    } catch (GeneralSecurityException | IllegalArgumentException e) {
      readable = false;
    }
    if (readable && identity.accepts(key, domain, owner)) return key;
    db
        .update(
            "UPDATE platform_task_credential SET valid=false WHERE domain_id=? AND creator_id=? AND"
                + " sealed_key IS NOT DISTINCT FROM ?",
            domain,
            owner,
            sealed);
    throw new Invalid();
  }
}
