package io.ontomato.dataengine.dataAdapter;

import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Component;

import io.ontomato.dataengine.config.DataRagConfig;

@Component
public class ClickHouseAdapterProvider implements DataAdapterProvider {

	@Override
	public String type() {
		return "clickhouse";
	}

	@Override
	public String label() {
		return "ClickHouse";
	}

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
		return Map.of("url", "jdbc:clickhouse://host:8123/default", "user", "default");
	}

	@Override
	public DataAdapter create(DataAdapterConnection connection, DataRagConfig dataRagConfig, Map<String, Object> jsonRule) {
		return new ClickHouseAdapter(connection, jsonRule);
	}
}
