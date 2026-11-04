package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSONObject;
import java.util.List;

/** Created by trusted Java callers, never deserialized from a model or HTTP body. */
public record PythonAuthority(String domainId, String userId, String purpose, String sandboxId,
    List<String> classNames, String executionId, ParentGrant parentGrant, JSONObject packageInput) {
  public record ParentGrant(String token, String runId, long expiresAt) {}
  public PythonAuthority forExecution(String id) {
    return new PythonAuthority(domainId, userId, purpose, sandboxId, classNames, id, parentGrant, packageInput);
  }
  public PythonAuthority withParent(ParentGrant grant) {
    return new PythonAuthority(domainId, userId, purpose, sandboxId, classNames, executionId, grant, packageInput);
  }
  public PythonAuthority withClasses(List<String> classes) {
    return new PythonAuthority(domainId, userId, purpose, sandboxId,
        classes == null ? List.of() : List.copyOf(classes), executionId, parentGrant, packageInput);
  }
  public PythonAuthority withPackage(JSONObject bundle, JSONObject parameters) {
    return new PythonAuthority(domainId, userId, "package-read", null, classNames, executionId,
        parentGrant, JSONObject.of("package", QueryPackage.copy(bundle), "parameters", QueryPackage.copy(parameters)));
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
