package io.ontomato.dataengine.bean.workflow;

/** The current editable workflow's identity and catalogue label. */
public record WorkflowDirectoryEntry(String id, String name, String status, Integer version) {}
