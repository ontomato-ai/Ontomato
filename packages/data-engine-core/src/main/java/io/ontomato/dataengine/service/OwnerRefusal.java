package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSONObject;

/**
 * An owner's explicit business refusal, carrying the code a caller reads to tell it from an execution failure.
 *
 * <p>An owner throws it only where one of its own rules refuses the request; every other exception is a failure and
 * carries no code. Codes are upper case with the owner's prefix, such as {@code ACTION_NOT_FOUND} or
 * {@code METRIC_VIEW_SYSTEM}; each owner keeps its own codes. A data-query controller answers a refusal as
 * {@code {success:false, code, message}} with HTTP 200, and an item of a batch answer as
 * {@code {id, outcome:"refusal", code, error:{message}}}. A failure keeps the same shapes without {@code code}.</p>
 */
public class OwnerRefusal extends RuntimeException {
  private final String code;

  public OwnerRefusal(String code, String message) {
    super(message);
    this.code = code;
  }

  public String code() {
    return code;
  }

  /** Writes this refusal into a data-query envelope. */
  public void writeTo(JSONObject envelope) {
    envelope.put("success", false);
    envelope.put("code", code);
    envelope.put("message", getMessage());
  }

  /** The item of a batch answer for the id this refusal refused. */
  public JSONObject item(String id) {
    return JSONObject.of("id", id, "outcome", "refusal", "code", code, "error", JSONObject.of("message", getMessage()));
  }
}
