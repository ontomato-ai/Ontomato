package io.ontomato.dataengine.dao;

/** A stored Function reference and the owning definition facts needed by its visibility check. */
public record FunctionDependency<T>(T definition, String functionId) {}
