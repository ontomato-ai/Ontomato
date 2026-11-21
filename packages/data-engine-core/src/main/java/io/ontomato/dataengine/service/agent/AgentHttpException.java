package io.ontomato.dataengine.service.agent;

import io.ontomato.dataengine.service.LangService;
import java.util.Map;

public class AgentHttpException extends RuntimeException {
  private final int status;
  private final String code;
  private final String messageKey;
  private final Map<String, String> messageValues;

  public AgentHttpException(int status, String code, String message) {
    this(status, code, message, null, Map.of());
  }

  private AgentHttpException(int status, String code, String message, String messageKey, Map<String, String> messageValues) {
    super(message);
    this.status = status;
    this.code = code;
    this.messageKey = messageKey;
    this.messageValues = messageValues;
  }

  public int status() {
    return status;
  }

  public String code() {
    return code;
  }

  /**
   * The same refusal, answered in its reader's language from the message {@code key}; {@code values} fill the key's
   * {@code {name}} slots. The English message stays the exception's own, for logs and callers outside an HTTP answer.
   */
  public AgentHttpException localized(String key, Map<String, String> values) {
    return new AgentHttpException(status, code, getMessage(), key, Map.copyOf(values));
  }

  /** What the reader is told: the localized message when this refusal has one, its English message otherwise. */
  public String message(LangService messages, String language) {
    if (messageKey == null) return getMessage();
    String text = messages.get(language, messageKey);
    if (text == null || text.equals(messageKey)) return getMessage();
    for (var value : messageValues.entrySet()) text = text.replace("{" + value.getKey() + "}", value.getValue());
    return text;
  }

  public static AgentHttpException missing() {
    return new AgentHttpException(404, "NOT_FOUND", "Resource not found");
  }

  public static AgentHttpException invalid(String message) {
    return new AgentHttpException(400, "INVALID_REQUEST", message);
  }
}
