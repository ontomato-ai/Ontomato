package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSONObject;
import java.util.List;

/** Created by trusted Java callers, never deserialized from a model or HTTP body. */
public record PythonAuthority(String domainId, String userId, String purpose, String sandboxId,
    List<String> classNames, String executionId, ParentGrant parentGrant, JSONObject packageInput,
    JSONObject identity) {
  public record ParentGrant(String token, String runId, long expiresAt) {}

  /**
   * The identity the runtime is handed as its own copy of this authority.
   *
   * <p>Carried on the authority rather than passed as a parameter because it is what the server
   * established about the caller, and every derived authority below must keep it: a copy that dropped
   * it would silently run with no identity at all.</p>
   */
  public PythonAuthority {
    identity = identity == null ? null : new JSONObject(identity);
  }

  /** An authority for a run whose identity the server did not establish. */
  public PythonAuthority(String domainId, String userId, String purpose, String sandboxId,
      List<String> classNames, String executionId, ParentGrant parentGrant, JSONObject packageInput) {
    this(domainId, userId, purpose, sandboxId, classNames, executionId, parentGrant, packageInput, null);
  }

  /**
   * The identity snapshot for a run, as JSON, or null when there is none to give.
   *
   * <p>Kept out of {@code parameters.json} on purpose: parameters are the caller's values and may say
   * anything, while this file is written by the runtime host and cannot be overridden by an input file.
   * Authorization never reads it — the token decides that — so a program using it is making a business
   * decision, not granting itself anything.</p>
   */
  public PythonAuthority withIdentity(JSONObject snapshot) {
    return new PythonAuthority(domainId, userId, purpose, sandboxId, classNames, executionId,
        parentGrant, packageInput, snapshot);
  }

  public PythonAuthority forExecution(String id) {
    return new PythonAuthority(domainId, userId, purpose, sandboxId, classNames, id, parentGrant, packageInput, identity);
  }
  public PythonAuthority withParent(ParentGrant grant) {
    return new PythonAuthority(domainId, userId, purpose, sandboxId, classNames, executionId, grant, packageInput, identity);
  }
  public PythonAuthority withClasses(List<String> classes) {
    return new PythonAuthority(domainId, userId, purpose, sandboxId,
        classes == null ? List.of() : List.copyOf(classes), executionId, parentGrant, packageInput, identity);
  }
  public PythonAuthority withPackage(JSONObject bundle, JSONObject parameters) {
    return new PythonAuthority(domainId, userId, "package-read", null, classNames, executionId,
        parentGrant, JSONObject.of("package", QueryPackage.copy(bundle), "parameters", QueryPackage.copy(parameters)),
        identity);
  }
  public static PythonAuthority read(String user, String domain) {
    return new PythonAuthority(domain, user, "user-read", null, List.of(), null, null, null, null);
  }
  public static PythonAuthority exploration(String user, String domain) {
    return new PythonAuthority(domain, user, "retrieval-exploration", null, List.of(), null, null, null, null);
  }
  public static PythonAuthority write(String user, String domain, String sandbox) {
    return new PythonAuthority(domain, user, "sandbox-write", sandbox, List.of(), null, null, null, null);
  }
  public static PythonAuthority calculation(String domain) {
    return new PythonAuthority(domain, "ontology-service", null, null, List.of(), null, null, null, null);
  }
}
