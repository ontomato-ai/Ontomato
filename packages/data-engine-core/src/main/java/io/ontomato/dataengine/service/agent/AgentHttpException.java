package io.ontomato.dataengine.service.agent;

public class AgentHttpException extends RuntimeException {
  private final int status;
  private final String code;

  public AgentHttpException(int status, String code, String message) {
    super(message);
    this.status = status;
    this.code = code;
  }

  public int status() {
    return status;
  }

  public String code() {
    return code;
  }

  public static AgentHttpException missing() {
    return new AgentHttpException(404, "NOT_FOUND", "Resource not found");
  }

  public static AgentHttpException invalid(String message) {
    return new AgentHttpException(400, "INVALID_REQUEST", message);
  }
}
