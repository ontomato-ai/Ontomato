package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

/**
 * The L1 grammar gate: a {@code timeseries} condition must name a {@code bucket} attribute. This is a
 * property of the DSL, not of any data source, so it is rejected as {@code INVALID_GRAMMAR} before an
 * adapter is asked to render it.
 */
class DslGrammarValidatorTest {

	private static final List<Map<String, Object>> CLASS_DEFS = List.of(Map.of("className", "/Sensor", "attrs",
			List.of(Map.of("name", "id", "type", "varchar"), Map.of("name", "name", "type", "varchar"),
					Map.of("name", "reading", "type", "bucket"))));

	private static JSONObject timeseriesDsl(String className, String field) {
		return JSON.parseObject("""
				{"answer":{"steps":[{"graph":{"patterns":[{"objects":[{"variable":"s","class":"%s",
				  "conditions":{"timeseries":{"properties":{"and":[{"field":"%s",
				    "conditions":[{"metric":"name","value":"load"}]}]}}}}]}]},
				  "output":{"fields":[{"variable":"s","field":"id","as":"id"}]}}]}}""".formatted(className, field));
	}

	@Test
	void duplicateObjectIndexIsRejectedAtTheRepeatedObject() {
		JSONObject dsl = JSON.parseObject("""
				{"answer":{"steps":[{"graph":{"patterns":[{"objects":[
				  {"idx":0,"variable":"s","class":"/Sensor"},
				  {"idx":0,"variable":"t","class":"/Sensor"}
				]}]},"output":{"fields":[{"variable":"s","field":"id","as":"id"}]}}]}}
				""");
		DslContractViolationException failure = assertThrows(DslContractViolationException.class,
				() -> DslGrammarValidator.validate(dsl, CLASS_DEFS));
		var violation = failure.getViolations().get(0);
		assertEquals(DslContractViolationException.Code.INVALID_GRAMMAR, violation.getCode());
		assertEquals("steps[0].patterns[0].objects[1].idx", violation.getDslPath());
	}

	@Test
	void aBucketFieldPassesTheGate() {
		assertDoesNotThrow(() -> DslGrammarValidator.validate(timeseriesDsl("/Sensor", "reading"), CLASS_DEFS));
	}

	@Test
	void aNonBucketFieldIsRejectedAsInvalidGrammar() {
		DslContractViolationException e = assertThrows(DslContractViolationException.class,
				() -> DslGrammarValidator.validate(timeseriesDsl("/Sensor", "name"), CLASS_DEFS));
		assertEquals(DslContractViolationException.Code.INVALID_GRAMMAR, e.getViolations().get(0).getCode());
		assertTrue(e.getViolations().get(0).getDslPath().contains("conditions.timeseries"), e.getMessage());
	}

	@Test
	void anUndefinedAttributeIsRejected() {
		DslContractViolationException e = assertThrows(DslContractViolationException.class,
				() -> DslGrammarValidator.validate(timeseriesDsl("/Sensor", "nope"), CLASS_DEFS));
		assertEquals(DslContractViolationException.Code.INVALID_GRAMMAR, e.getViolations().get(0).getCode());
		assertTrue(e.getMessage().contains("not defined"), e.getMessage());
	}

	@Test
	void aDslWithoutTimeseriesPassesTheGate() {
		JSONObject dsl = JSON.parseObject("""
				{"answer":{"steps":[{"graph":{"patterns":[{"objects":[{"variable":"s","class":"/Sensor"}]}]},
				  "output":{"fields":[{"variable":"s","field":"id","as":"id"}]}}]}}""");
		assertDoesNotThrow(() -> DslGrammarValidator.validate(dsl, CLASS_DEFS));
	}

	/** An unknown class is a different failure; the gate must not disguise it as a grammar error. */
	@Test
	void anUnknownClassIsLeftToTheOtherChecks() {
		assertDoesNotThrow(() -> DslGrammarValidator.validate(timeseriesDsl("/Missing", "name"), CLASS_DEFS));
	}

	@Test
	void aSqlExpressionInAnOutputFieldIsRejectedWithItsFieldPath() {
		JSONObject dsl = JSON.parseObject("""
				{"answer":{"steps":[
				 {"graph":{"patterns":[{"objects":[{"idx":0,"variable":"p","class":"/person"}]}],"pattern_logic":"and"},
				  "output":{"fields":[{"as":"person_id","variable":"p","field":"id"},{"as":"person_status","variable":"p","field":"status"}],"to_user":false,"save_table":"/person_all"}},
				 {"graph":{"patterns":[{"objects":[{"class":"/person_all","variable":"t"}]}],"pattern_logic":"and"},
				  "output":{"fields":[{"as":"all_person_count","variable":"t","field":"person_id","function":"count","distinct":true},
				   {"as":"active_person_count","expr":"SUM(CASE WHEN t.person_status = 'active' THEN 1 ELSE 0 END)"}],"to_user":true}}]}}""");

		DslContractViolationException e = assertThrows(DslContractViolationException.class,
				() -> DslGrammarValidator.validate(dsl, CLASS_DEFS));

		assertEquals(DslContractViolationException.Code.INVALID_GRAMMAR, e.getViolations().get(0).getCode());
		assertEquals("steps[1].output.fields[1].expr", e.getViolations().get(0).getDslPath());
	}

	@Test
	void anOutputFieldWithoutVariableFieldOrExprIsRejected() {
		JSONObject dsl = JSON.parseObject("""
				{"answer":{"steps":[{"graph":{"patterns":[{"objects":[{"variable":"s","class":"/Sensor"}]}]},
				  "output":{"fields":[{"as":"count"}]}}]}}""");

		DslContractViolationException e = assertThrows(DslContractViolationException.class,
				() -> DslGrammarValidator.validate(dsl, CLASS_DEFS));

		assertEquals("steps[0].output.fields[0]", e.getViolations().get(0).getDslPath());
	}

	@Test
	void arithmeticExprAfterATemporaryTablePassesTheGate() {
		JSONObject dsl = JSON.parseObject("""
				{"answer":{"steps":[
				 {"graph":{"patterns":[{"objects":[{"variable":"s","class":"/Sensor"}]}]},
				  "output":{"fields":[{"variable":"s","field":"id","as":"id"}],"save_table":"/sensor_tmp"}},
				 {"graph":{"patterns":[{"objects":[{"variable":"t","class":"/sensor_tmp"}]}]},
				  "output":{"fields":[{"expr":"t.id / 2 + 1","as":"half"}]}}]}}""");

		assertDoesNotThrow(() -> DslGrammarValidator.validate(dsl, CLASS_DEFS));
	}

	@Test
	void conditionsOutsidePropertiesAreRejectedInsteadOfIgnored() {
		var dsl = com.alibaba.fastjson2.JSON.parseObject("""
				{"answer":{"steps":[{"graph":{"patterns":[{"objects":[{"idx":0,"variable":"p","class":"/person",
				  "conditions":{"operator":"logic","and":[{"field":"status","operator":"=","value":"x"}]}}]}]},
				  "output":{"to_user":true,"fields":[{"as":"n","variable":"p","field":"id","function":"count"}]}}]}}
				""");
		var error = org.junit.jupiter.api.Assertions.assertThrows(DslContractViolationException.class,
				() -> DslGrammarValidator.validate(dsl, java.util.List.of()));
		org.junit.jupiter.api.Assertions.assertTrue(error.getMessage().contains("conditions.properties"), error.getMessage());
	}

	/** The 2026-11-28 regression's question 5: a party filter written on the temporary table was silently dropped. */
	private static JSONObject twoStepDsl(String secondStepConditions) {
		return JSON.parseObject("""
				{"answer":{"steps":[
				  {"graph":{"patterns":[{"objects":[{"variable":"p","class":"/Person",
				    "conditions":{"properties":{"field":"status","operator":"=","value":"active"}}}]}]},
				   "output":{"to_user":false,"save_table":"/t1","fields":[{"variable":"p","field":"id","as":"id"},
				     {"variable":"p","field":"polity","as":"polity"}]}},
				  {"graph":{"patterns":[{"objects":[{"variable":"t","class":"/t1"%s}]}]},
				   "output":{"to_user":true,"fields":[{"variable":"t","field":"id","as":"headcount","function":"count"}]}}]}}"""
				.formatted(secondStepConditions));
	}

	@Test
	void aConditionOnATemporaryTableIsRejectedAtItsStep() {
		DslContractViolationException e = assertThrows(DslContractViolationException.class, () -> DslGrammarValidator
				.validate(twoStepDsl(",\"conditions\":{\"properties\":{\"field\":\"polity\",\"operator\":\"=\",\"value\":\"party member\"}}"),
						List.of()));
		assertEquals(DslContractViolationException.Code.INVALID_GRAMMAR, e.getViolations().get(0).getCode());
		assertEquals("steps[1].patterns[0].objects[0].conditions", e.getViolations().get(0).getDslPath());
		assertTrue(e.getMessage().contains("Filter the objects in steps[0]"), e.getMessage());
	}

	@Test
	void aTemporaryTableWithoutConditionsPassesTheGate() {
		assertDoesNotThrow(() -> DslGrammarValidator.validate(twoStepDsl(""), List.of()));
		assertDoesNotThrow(() -> DslGrammarValidator.validate(twoStepDsl(",\"conditions\":{\"properties\":{}}"), List.of()));
	}

	@ParameterizedTest
	@CsvSource({"function, .fields[0].function", "distinct, .fields[0].distinct", "group_by, .group_by"})
	void calculationIsRejectedInAnyStepWithMultipleObjects(String calculation, String path) {
		var object = JSONObject.of("class", "/Person", "variable", "p", "idx", 0);
		var pattern = JSONObject.of("objects", JSONArray.of(object));
		var graph = JSONObject.of("patterns", JSONArray.of(pattern));
		var field = JSONObject.of("as", "result", "variable", "p", "field", "id");
		var output = JSONObject.of("fields", JSONArray.of(field));
		switch (calculation) {
			case "function" -> field.put("function", "count");
			case "distinct" -> field.put("distinct", true);
			case "group_by" -> output.put("group_by", JSONObject.of("fields",
					JSONArray.of(JSONObject.of("variable", "p", "field", "id"))));
		}
		var query = JSONObject.of("answer", JSONObject.of("steps",
				JSONArray.of(JSONObject.of("graph", graph, "output", output))));
		assertDoesNotThrow(() -> DslGrammarValidator.validate(query, List.of()));

		pattern.getJSONArray("objects").add(JSONObject.of("class", "/Department", "variable", "d", "idx", 1));
		var failure = assertThrows(DslContractViolationException.class, () -> DslGrammarValidator.validate(query, List.of()));
		var violation = failure.getViolations().getFirst();
		assertEquals(DslContractViolationException.Code.INVALID_GRAMMAR, violation.getCode());
		assertEquals("steps[0].output" + path, violation.getDslPath());
		assertTrue(failure.getMessage().contains("temporary table"), failure.getMessage());

		query.getJSONObject("answer").getJSONArray("steps")
				.add(twoStepDsl("").getJSONObject("answer").getJSONArray("steps").getJSONObject(1));
		var twoStepFailure = assertThrows(DslContractViolationException.class,
				() -> DslGrammarValidator.validate(query, List.of()));
		assertEquals(violation.getDslPath(), twoStepFailure.getViolations().getFirst().getDslPath());
	}

}
