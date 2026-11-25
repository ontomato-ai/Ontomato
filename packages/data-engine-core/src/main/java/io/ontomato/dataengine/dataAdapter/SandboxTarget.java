package io.ontomato.dataengine.dataAdapter;

import java.security.SecureRandom;
import java.util.Map;
import java.util.Objects;

/** Physical names assigned by the data sandbox owner. */
public record SandboxTarget(String sandboxId, String deployTag, String shortId,
    Map<String, String> classTables, Map<String, String> edgeTables,
    Map<String, String> vectorTables) {

    private static final String ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
    private static final SecureRandom RANDOM = new SecureRandom();

    public SandboxTarget {
        classTables = Map.copyOf(classTables);
        edgeTables = Map.copyOf(edgeTables);
        vectorTables = Map.copyOf(vectorTables);
    }

    public static String randomTag(int length) {
        var tag = new StringBuilder(length);
        for (int index = 0; index < length; index++) {
            tag.append(ALPHABET.charAt(RANDOM.nextInt(ALPHABET.length())));
        }
        return tag.toString();
    }

    public static String deploymentPrefix(String deployTag) {
        if (!deployTag.matches("[a-z0-9]{6}")) throw new IllegalArgumentException("Invalid deployment tag");
        return "ot_sb_" + deployTag + "_";
    }

    public String namespace() {
        return deploymentPrefix(deployTag) + shortId;
    }

    public String classTable(String name) {
        return Objects.requireNonNull(classTables.get(name), "Class outside the sandbox: " + name);
    }

    public String edgeTable(String name) {
        return Objects.requireNonNull(edgeTables.get(name), "Relationship outside the sandbox: " + name);
    }

    public static String vectorKey(String className, String attrName) {
        return com.alibaba.fastjson2.JSON.toJSONString(new String[] {className, attrName});
    }

    public String vectorTable(String className, String attrName) {
        return Objects.requireNonNull(vectorTables.get(vectorKey(className, attrName)),
                "Vector attribute outside the sandbox: " + className + "." + attrName);
    }
}
