package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.*;
import java.util.Set;

/** The single answer protocol for read Python consumers. */
public final class PythonRows {
  private PythonRows() {}

  /** A result contract failure or the diagnostic already sanitized by the Python execution owner. */
  public static final class InvalidResult extends Exception {
    private InvalidResult(String message) {
      super(message);
    }
  }

  public static JSONArray parse(String output, String error) throws Exception {
    if (error != null && !error.isBlank()) throw new InvalidResult(error);
    try {
      var value = JSON.parseObject(output.replaceAll(":\\s*NaN", ": null"));
      if (!value.keySet().equals(Set.of("answer")) || value.getJSONArray("answer") == null)
        throw new IllegalArgumentException();
      return value.getJSONArray("answer");
    } catch (Exception invalid) {
      throw new InvalidResult("Python must print one JSON object containing an answer array");
    }
  }
}
