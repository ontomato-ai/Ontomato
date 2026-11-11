package io.ontomato.dataengine.dataAdapter;

import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Component;

import io.ontomato.dataengine.config.DataRagConfig;

@Component
public class MongoAdapterProvider implements DataAdapterProvider {

	@Override
	public String type() {
		return "mongodb";
	}

	@Override
	public String label() {
		return "MongoDB";
	}

	/** Relationships are stored as a key field on the source document, so they name fromField/toField. */
	@Override
	public boolean requiresJoinFields() {
		return true;
	}

	@Override
	public List<String> connectionFields() {
		return List.of("url", "user", "password");
	}

	@Override
	public Map<String, String> connectionExamples() {
		return Map.of("url", "mongodb://host:27017/db", "user", "mongodb");
	}

	@Override
	public DataAdapter create(DataAdapterConnection connection, DataRagConfig dataRagConfig, Map<String, Object> jsonRule) {
		return new MongoAdapter(connection, jsonRule);
	}
}
