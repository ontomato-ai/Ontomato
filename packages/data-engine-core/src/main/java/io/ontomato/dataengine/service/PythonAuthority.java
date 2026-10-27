package io.ontomato.dataengine.service;

/** Created by trusted Java callers, never deserialized from a model or HTTP body. */
public record PythonAuthority(
    String domainId,
    String userId,
    String purpose,
    String sandboxId,
    java.util.List<String> classNames,
    String executionId,
    ParentGrant parentGrant) {
  public record ParentGrant(String token, String runId, long expiresAt) {}

  public PythonAuthority forExecution(String id) {
    return new PythonAuthority(domainId, userId, purpose, sandboxId, classNames, id, parentGrant);
  }

  public PythonAuthority withParent(ParentGrant grant) {
    return new PythonAuthority(
        domainId, userId, purpose, sandboxId, classNames, executionId, grant);
  }

  public PythonAuthority withClasses(java.util.List<String> classes) {
    return new PythonAuthority(
        domainId,
        userId,
        purpose,
        sandboxId,
        classes == null ? java.util.List.of() : classes,
        executionId,
        parentGrant);
  }

  public static PythonAuthority read(String user, String domain) {
    return new PythonAuthority(domain, user, "user-read", null, java.util.List.of(), null, null);
  }

  public static PythonAuthority exploration(String domain) {
    return new PythonAuthority(
        domain, "ontology-service", "retrieval-exploration", null, java.util.List.of(), null, null);
  }

  public static PythonAuthority write(String domain, String sandbox) {
    return new PythonAuthority(
        domain, "ontology-service", "sandbox-write", sandbox, java.util.List.of(), null, null);
  }

  public static PythonAuthority calculation(String domain) {
    return new PythonAuthority(
        domain, "ontology-service", null, null, java.util.List.of(), null, null);
  }
}
