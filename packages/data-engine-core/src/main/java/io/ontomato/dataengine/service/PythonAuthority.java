package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSONObject;
import java.util.List;

/** Created by trusted Java callers, never deserialized from a model or HTTP body. */
public record PythonAuthority(String domainId, String userId, String purpose, String sandboxId,
    List<String> classNames, String executionId, ParentGrant parentGrant, JSONObject packageInput,
    JSONObject identity, ExecutionTarget target, String executionUserId, String initiatorUserId) {
  public PythonAuthority(String domainId, String userId, String purpose, String sandboxId, List<String> classNames,
      String executionId, ParentGrant parentGrant, JSONObject packageInput, JSONObject identity, ExecutionTarget target) {
    this(domainId,userId,purpose,sandboxId,classNames,executionId,parentGrant,packageInput,identity,target,null,null);
  }
  public PythonAuthority withExecution(String executor, String initiator) {
    return new PythonAuthority(domainId,userId,purpose,sandboxId,classNames,executionId,parentGrant,packageInput,identity,target,executor,initiator);
  }
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
    this(domainId, userId, purpose, sandboxId, classNames, executionId, parentGrant, packageInput, null, ExecutionTarget.LIVE);
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
        parentGrant, packageInput, snapshot, target, executionUserId, initiatorUserId);
  }

  public PythonAuthority withTarget(ExecutionTarget value) {
    if(!classNames.isEmpty())value.requireClasses(classNames);
    return new PythonAuthority(domainId, userId, purpose, value.testing() ? value.sandboxId() : sandboxId,
        classNames.isEmpty() ? value.classNames() : classNames, executionId,
        parentGrant, packageInput, identity, value, value.initiatorUserId()!=null?value.executionUserId():executionUserId, value.initiatorUserId()!=null?value.initiatorUserId():initiatorUserId);
  }

  /** The build-test scope remains active while the author's writes go to the run's own sandbox. */
  public PythonAuthority withAuthorSandbox(String sandbox) {
    return new PythonAuthority(domainId, userId, purpose, sandbox, classNames, executionId,
        parentGrant, packageInput, identity, target, executionUserId, initiatorUserId);
  }

  public PythonAuthority forExecution(String id) {
    return new PythonAuthority(domainId, userId, purpose, sandboxId, classNames, id, parentGrant, packageInput, identity, target, executionUserId, initiatorUserId);
  }
  public PythonAuthority withParent(ParentGrant grant) {
    return new PythonAuthority(domainId, userId, purpose, sandboxId, classNames, executionId, grant, packageInput, identity, target, executionUserId, initiatorUserId);
  }
  public PythonAuthority withClasses(List<String> classes) {
    return new PythonAuthority(domainId, userId, purpose, sandboxId,
        classes == null ? List.of() : List.copyOf(classes), executionId, parentGrant, packageInput, identity, target, executionUserId, initiatorUserId);
  }
  public PythonAuthority withPackage(JSONObject bundle, JSONObject parameters) {
    return new PythonAuthority(domainId, userId, "package-read", sandboxId, classNames, executionId,
        parentGrant, JSONObject.of("package", QueryPackage.copy(bundle), "parameters", QueryPackage.copy(parameters)),
        identity, target, executionUserId, initiatorUserId);
  }
  public static PythonAuthority read(String user, String domain) {
    return new PythonAuthority(domain, user, "user-read", null, List.of(), null, null, null);
  }
  public static PythonAuthority exploration(String user, String domain) {
    return new PythonAuthority(domain, user, "retrieval-exploration", null, List.of(), null, null, null);
  }
  public static PythonAuthority write(String user, String domain, String sandbox) {
    return new PythonAuthority(domain, user, "sandbox-write", sandbox, List.of(), null, null, null);
  }
  public static PythonAuthority calculation(String domain) {
    return new PythonAuthority(domain, "ontology-service", null, null, List.of(), null, null, null);
  }
}
