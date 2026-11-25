package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;

import org.junit.jupiter.api.Test;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

class GaussDBAdapterGraphContractTest {

	private final GaussDBAdapter adapter = new GaussDBAdapter(null, jsonRule());

	@Test
	void multipleRelationshipTypesAreRejected() {
		assertViolation(JSONArray.of("performed_by", "acts_on"), 1, 1);
	}

	@Test
	void wildcardRelationshipTypeIsRejected() {
		assertViolation(JSONArray.of("*"), 1, 1);
	}

	@Test
	void multiHopRangeIsRejected() {
		assertViolation(JSONArray.of("performed_by"), 1, 2);
	}

	private void assertViolation(JSONArray types, int minHops, int maxHops) {
		DslContractViolationException error = assertThrows(DslContractViolationException.class,
				() -> adapter.executeDsl(JSONArray.of(dsl(types, minHops, maxHops)).toJSONString(),
						"gauss-contract", DslExecutionMode.RAW, new ArrayList<>()));
		assertTrue(error.getViolations().stream().anyMatch(
				v -> v.getCode() == DslContractViolationException.Code.UNSUPPORTED_CONSTRUCT
						&& v.getDslPath() != null
						&& !v.getDslPath().isBlank()), error.getMessage());
	}

	private JSONObject dsl(JSONArray types, int minHops, int maxHops) {
		JSONObject relationship = JSONObject.of(
				"from", 0,
				"to", 1,
				"type", types,
				"min_hops", minHops,
				"max_hops", maxHops);
		JSONObject pattern = JSONObject.of(
				"objects", JSONArray.of(
						JSONObject.of("class", "person", "variable", "s", "idx", 0),
						JSONObject.of("class", "org", "variable", "t", "idx", 1)),
				"relationship", JSONArray.of(relationship));
		JSONObject step = JSONObject.of(
				"graph", JSONObject.of("patterns", JSONArray.of(pattern)),
				"output", JSONObject.of("fields", new JSONArray()));
		return JSONObject.of("answer", JSONObject.of("steps", JSONArray.of(step)));
	}

	private JSONObject jsonRule() {
		JSONObject person = JSONObject.of(
				"className", "person",
				"attrs", JSONArray.of(JSONObject.of("name", "id", "type", "varchar", "primaryKey", true)));
		JSONObject org = JSONObject.of(
				"className", "org",
				"attrs", JSONArray.of(JSONObject.of("name", "id", "type", "varchar", "primaryKey", true)));
		JSONObject relationship = JSONObject.of(
				"fromclass", "person",
				"toclass", "org",
				"fromField", "org_id",
				"toField", "id");
		return JSONObject.of(
				"classDef", JSONArray.of(person, org),
				"relationship_rule", JSONObject.of("performed_by", relationship));
	}
}
