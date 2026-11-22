package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSONObject;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;

/**
 * An owner's refusal of a value at one form field. Besides the refusal's code and message, its envelope carries
 * {@code errors}: the same JSON Pointers and codes a form read reports, so the panel marks the field that failed.
 */
public class OwnerFieldRefusal extends OwnerRefusal {
  private final List<ObjectNode> errors;

  /** {@code field} is the JSON Pointer of the refused value and {@code fieldCode} a code from contracts/form-fields.ts. */
  public OwnerFieldRefusal(String code, String field, String fieldCode, String message) {
    super(code, text(code, message));
    this.errors = List.of(FormFields.error(field, fieldCode, getMessage()));
  }

  /** Multiple form field errors refused together in one save. */
  public OwnerFieldRefusal(String code, List<ObjectNode> errors, String message) {
    super(code, text(code, message));
    this.errors = List.copyOf(errors);
  }

  /** A field error always says why; a validator without a message leaves the refusal's code. */
  private static String text(String code, String message) {
    return message == null || message.isBlank() ? code : message;
  }

  public List<ObjectNode> errors() {
    return errors;
  }

  @Override
  public void writeTo(JSONObject envelope) {
    super.writeTo(envelope);
    envelope.put("errors", errors);
  }
}
