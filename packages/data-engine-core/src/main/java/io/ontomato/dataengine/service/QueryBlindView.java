package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgram;
import java.util.HashSet;

/** A rule-based text projection for the independent describer; it never executes code or infers lineage. */
public final class QueryBlindView {
  private QueryBlindView() {}

  public static JSONObject of(ABCHarnessProgram program) {
    var input = QuerySourceSnapshot.input(program);
    var bundle = input.getJSONObject("package");
    var manifest = bundle.getJSONObject("manifest");
    // Computation declarations and display labels are explanations, not executed source.
    manifest.remove("computation");
    for (String key : new String[]{"problem", "title", "description", "logic", "summary", "columnLabels"})
      manifest.remove(key);
    var definitions = manifest.getJSONArray("parameterDefs");
    if (definitions != null) for (Object item : definitions) {
      var definition = (JSONObject) item;
      definition.remove("description");
      definition.remove("sample");
    }
    var queryPaths = new HashSet<Object>(manifest.getJSONObject("queries").values());
    for (Object item : bundle.getJSONArray("files")) {
      var file = (JSONObject) item;
      String source = file.getString("content");
      if (queryPaths.contains(file.getString("path"))) {
        var dsl = JSON.parseObject(source);
        dsl.remove("problem");
        file.put("content", JSON.toJSONString(dsl, JSONWriter.Feature.WriteMapNullValue));
      } else file.put("content", python(source));
    }
    return input;
  }

  /** Remove comments and standalone documentation strings while preserving literals and identifiers. */
  public static String python(String source) {
    var out = new StringBuilder(source.length());
    char quote = 0;
    boolean triple = false, documentation = false;
    int brackets = 0;
    boolean statementStart = true;
    for (int i = 0; i < source.length();) {
      char c = source.charAt(i);
      if (quote != 0) {
        if (c == '\\' && i + 1 < source.length()) {
          if (!documentation) out.append(c).append(source.charAt(i + 1));
          else if (source.charAt(i + 1) == '\n') out.append('\n');
          i += 2; continue;
        }
        boolean end = c == quote && (!triple || i + 2 < source.length() && source.charAt(i + 1) == quote && source.charAt(i + 2) == quote);
        if (end) {
          int length = triple ? 3 : 1;
          if (!documentation) out.append(source, i, i + length);
          i += length; quote = 0; triple = false; documentation = false; continue;
        }
        if (!documentation || c == '\n') out.append(c);
        i++; continue;
      }
      if (statementStart && brackets == 0 && "rRuU".indexOf(c) >= 0 && i + 1 < source.length()
          && (source.charAt(i + 1) == '\'' || source.charAt(i + 1) == '"')) {
        i++; continue;
      }
      if (c == '\\' && i + 1 < source.length() && source.charAt(i + 1) == '\n') {
        out.append(c).append('\n'); i += 2; continue;
      }
      if (c == '#') {
        while (i < source.length() && source.charAt(i) != '\n') i++;
        continue;
      }
      if (c == '\'' || c == '"') {
        quote = c;
        triple = i + 2 < source.length() && source.charAt(i + 1) == c && source.charAt(i + 2) == c;
        documentation = statementStart && brackets == 0;
        int length = triple ? 3 : 1;
        if (!documentation) out.append(source, i, i + length);
        i += length; statementStart = false; continue;
      }
      if (c == '\n') statementStart = brackets == 0;
      else if (!Character.isWhitespace(c)) {
        statementStart = c == ';' && brackets == 0;
        if (c == '(' || c == '[' || c == '{') brackets++;
        if (c == ')' || c == ']' || c == '}') brackets--;
      }
      out.append(c); i++;
    }
    return out.toString();
  }
}
