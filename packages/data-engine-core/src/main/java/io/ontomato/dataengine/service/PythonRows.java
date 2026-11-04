package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.*;
import java.util.Set;

/** The single answer protocol for read Python consumers. */
public final class PythonRows {
  private PythonRows() {}
  public static JSONArray parse(String output, String error) throws Exception {
    if (error != null && !error.isBlank()) throw new Exception(error);
    try {
      var value = JSON.parseObject(output.replaceAll(":\\s*NaN", ": null"));
      if (!value.keySet().equals(Set.of("answer")) || value.getJSONArray("answer") == null)
        throw new IllegalArgumentException();
      return value.getJSONArray("answer");
    } catch (Exception invalid) {
      throw new Exception("Python must print one JSON object containing an answer array");
    }
  }
}
