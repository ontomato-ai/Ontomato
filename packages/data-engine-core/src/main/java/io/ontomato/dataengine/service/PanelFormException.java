package io.ontomato.dataengine.service;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;

/** A form draft the owner refuses, with the field errors the panel shows by pointer. */
public final class PanelFormException extends RuntimeException {
  private final List<ObjectNode> fields;

  public PanelFormException(String message, List<ObjectNode> fields) {
    super(message);
    this.fields = List.copyOf(fields);
  }

  public List<ObjectNode> fields() {
    return fields;
  }
}
