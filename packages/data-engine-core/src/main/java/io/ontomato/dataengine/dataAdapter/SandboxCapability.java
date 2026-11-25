package io.ontomato.dataengine.dataAdapter;

import com.alibaba.fastjson2.JSONObject;

public record SandboxCapability(String status, boolean supported, boolean canCreateAndDrop,
    String reason, String probeNote, JSONObject details) {

    private static final String NOTE =
        "This check creates and deletes one empty table or its equivalent in the business data source.";

    public static SandboxCapability unsupported() {
        return unsupported("This data source type does not support write actions.");
    }

    public static SandboxCapability unsupported(String reason) {
        return new SandboxCapability("unsupported", false, false, reason,
            "No probe object is created for a read-only source.", new JSONObject());
    }

    public static SandboxCapability unchecked() {
        return new SandboxCapability("unchecked", true, false,
            "Sandbox permissions have not been checked for this connection.", NOTE, new JSONObject());
    }

    public static SandboxCapability failed(String operation, Exception failure) {
        return new SandboxCapability("failed", true, false,
            "Cannot " + operation + " the sandbox probe object: " + failure.getMessage()
                + ". Action trials require permission to create and drop sandbox objects.", NOTE,
            JSONObject.of("operation", operation));
    }

    public static SandboxCapability passed() {
        return new SandboxCapability("passed", true, true, "Sandbox probe created and deleted successfully.", NOTE, new JSONObject());
    }

    public SandboxCapability withDetails(JSONObject details) {
        return new SandboxCapability(status, supported, canCreateAndDrop, reason, probeNote, details);
    }

    public JSONObject json() {
        return JSONObject.of("status", status, "supported", supported, "canCreateAndDrop", canCreateAndDrop,
            "reason", reason, "probeNote", probeNote, "details", details);
    }

    @FunctionalInterface
    public interface Operation {
        void run(String name) throws Exception;
    }

    public static SandboxCapability probe(String deployTag, Operation create, Operation drop) {
        String name = SandboxTarget.deploymentPrefix(deployTag) + "p_" + SandboxTarget.randomTag(8);
        boolean created = false;
        SandboxCapability outcome;
        try {
            create.run(name);
            created = true;
            outcome = passed();
        } catch (Exception failure) {
            outcome = failed("create", failure);
        } finally {
            if (created) {
                try {
                    drop.run(name);
                } catch (Exception failure) {
                    outcome = failed("drop", failure);
                }
            }
        }
        return outcome;
    }
}
