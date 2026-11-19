package io.ontomato.dataengine.service;

import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.databind.node.ObjectNode;

/** One refused ontology-model request, carrying the HTTP status and the error contract's code and details. */
public class OntologyModelException extends RuntimeException {

	private final int status;
	private final String code;
	private final Map<String, Object> details;

	public OntologyModelException(int status, String code, String message, Map<String, Object> details) {
		super(message);
		this.status = status;
		this.code = code;
		this.details = details;
	}

	public int status() {
		return status;
	}

	public String code() {
		return code;
	}

	public Map<String, Object> details() {
		return details;
	}

	public static OntologyModelException validation(List<ObjectNode> fields, String message) {
		return new OntologyModelException(422, "FIELD_VALIDATION_FAILED", message, Map.of("fields", fields));
	}

	public static OntologyModelException notFound(String code, String message) {
		return new OntologyModelException(404, code, message, Map.of());
	}

	public static OntologyModelException conflict(String code, String message, Map<String, Object> details) {
		return new OntologyModelException(409, code, message, details);
	}
}
