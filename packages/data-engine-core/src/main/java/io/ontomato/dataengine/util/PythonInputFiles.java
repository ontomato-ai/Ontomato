package io.ontomato.dataengine.util;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Materializes the exact cached inputs selected by the traditional query owner. */
public final class PythonInputFiles {
  private PythonInputFiles() {}

  public static Map<String, String> fromSchema(List<Map> schema) throws java.io.IOException {
    Map<String, String> files = new LinkedHashMap<>();
    for (int i = 0; i < schema.size(); i++)
      files.put(
          "inputs/" + i + ".json",
          Files.readString(Path.of((String) schema.get(i).get("datajsonfile"))));
    return files;
  }

  public static void stage(Path root, Map<String, String> files) throws java.io.IOException {
    for (var entry : files.entrySet()) {
      Path target = root.resolve(entry.getKey()).normalize();
      if (!target.startsWith(root.normalize()))
        throw new IllegalArgumentException("Input path escapes workspace");
      Files.createDirectories(target.getParent());
      Files.writeString(target, entry.getValue());
    }
  }

  public static Map<String, String> staged(Path root) throws java.io.IOException {
    Map<String, String> files = new LinkedHashMap<>();
    Path inputs = root.resolve("inputs");
    if (!Files.exists(inputs)) return files;
    try (var paths = Files.walk(inputs)) {
      for (Path file : paths.toList()) {
        if (Files.isSymbolicLink(file))
          throw new IllegalArgumentException("Input symbolic link is not allowed");
        if (Files.isRegularFile(file))
          files.put(root.relativize(file).toString().replace('\\', '/'), Files.readString(file));
      }
    }
    return files;
  }
}
