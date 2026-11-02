package io.ontomato.dataengine.service.agent;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Renders the public Python helper API from the single {@code python/query_runtime.py} source.
 *
 * <p>Prompts and skills reference this generated view instead of copying signatures, so a helper
 * change is picked up without editing a second document.
 */
public final class PythonHelperDocs {
  private static final Pattern FUNCTION =
      Pattern.compile("^def\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\((.*)$");

  private PythonHelperDocs() {}

  public static String markdown() {
    String source = resource();
    StringBuilder out = new StringBuilder();
    out.append("# Python helper API\n\n");
    out.append("Generated from `python/query_runtime.py`; do not edit this document by hand.\n\n");
    List<String> lines = source.lines().toList();
    for (int index = 0; index < lines.size(); index++) {
      Matcher matcher = FUNCTION.matcher(lines.get(index));
      if (!matcher.find()) continue;
      String name = matcher.group(1);
      if (name.startsWith("_")) continue;

      StringBuilder signature = new StringBuilder(lines.get(index).trim());
      int next = index + 1;
      while (!complete(signature.toString()) && next < lines.size()) {
        signature.append('\n').append(lines.get(next).trim());
        next++;
      }
      String doc = docstring(lines, next);
      out.append("## `").append(name).append("`\n\n");
      out.append("```python\n").append(signature).append("\n```\n\n");
      if (!doc.isBlank()) out.append(doc).append("\n\n");
      index = next - 1;
    }
    return out.toString();
  }

  private static boolean complete(String signature) {
    int depth = 0;
    for (int i = 0; i < signature.length(); i++) {
      char current = signature.charAt(i);
      if (current == '(') depth++;
      else if (current == ')') depth--;
    }
    return depth == 0 && signature.stripTrailing().endsWith(":");
  }

  private static String docstring(List<String> lines, int start) {
    int index = start;
    while (index < lines.size() && lines.get(index).isBlank()) index++;
    if (index >= lines.size()) return "";
    String line = lines.get(index).strip();
    if (!line.startsWith("\"\"\"")) return "";
    String first = line.substring(3);
    if (first.endsWith("\"\"\"")) return first.substring(0, first.length() - 3).strip();
    StringBuilder doc = new StringBuilder();
    if (!first.isBlank()) doc.append(first).append('\n');
    index++;
    while (index < lines.size()) {
      String current = lines.get(index);
      int end = current.indexOf("\"\"\"");
      if (end >= 0) {
        doc.append(current, 0, end);
        break;
      }
      doc.append(current).append('\n');
      index++;
    }
    return doc.toString().strip();
  }

  private static String resource() {
    try (InputStream in = PythonHelperDocs.class.getResourceAsStream("/python/query_runtime.py")) {
      if (in == null) throw new IllegalStateException("Missing python/query_runtime.py");
      return new String(in.readAllBytes(), StandardCharsets.UTF_8);
    } catch (Exception error) {
      throw new IllegalStateException("Cannot read python/query_runtime.py", error);
    }
  }
}
