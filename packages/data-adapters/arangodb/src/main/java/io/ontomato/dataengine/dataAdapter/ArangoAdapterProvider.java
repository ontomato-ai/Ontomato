package io.ontomato.dataengine.dataAdapter;

import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Component;

import io.ontomato.dataengine.config.DataRagConfig;

@Component
public class ArangoAdapterProvider implements DataAdapterProvider {

	@Override
	public String type() {
		return "arangodb";
	}

	@Override
	public String label() {
		return "ArangoDB";
	}

	/** ArangoDB stores relationships as real edge documents, so a relation needs no join fields. */
	@Override
	public boolean requiresJoinFields() {
		return false;
	}

	/** The HTTP endpoint of the server; the user and password of an ArangoDB credential. */
	@Override
	public List<String> connectionFields() {
		return List.of("url", "user", "password");
	}

	@Override
	public Map<String, String> connectionExamples() {
		return Map.of("url", "http://host:8529", "user", "root");
	}

	@Override
	public DataAdapter create(DataAdapterConnection connection, DataRagConfig dataRagConfig, Map<String, Object> jsonRule) {
		return new ArangoAdapter(connection, jsonRule);
	}
}
