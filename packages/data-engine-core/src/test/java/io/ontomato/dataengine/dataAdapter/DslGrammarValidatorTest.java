package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.alibaba.fastjson2.JSON;
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
	void aBucketFieldPassesTheGate() {
		assertDoesNotThrow(() -> DslGrammarValidator.validate(timeseriesDsl("/Sensor", "reading"), CLASS_DEFS));
	}

	@Test
	void aNonBucketFieldIsRejectedAsInvalidGrammar() {
		DslContractViolationException e = assertThrows(DslContractViolationException.class,
				() -> DslGrammarValidator.validate(timeseriesDsl("/Sensor", "name"), CLASS_DEFS));
		assertEquals(DslContractViolationException.Code.INVALID_GRAMMAR, e.getViolations().get(0).getCode());
		assertTrue(e.getViolations().get(0).getDslPath().contains("conditions.timeseries"), e.getMessage());
		assertTrue(e.getMessage().contains("bucket"), e.getMessage());
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
		assertTrue(e.getMessage().contains("arithmetic"), e.getMessage());
		assertTrue(e.getMessage().contains("CASE"), e.getMessage());
	}

	@Test
	void anOutputFieldWithoutVariableFieldOrExprIsRejected() {
		JSONObject dsl = JSON.parseObject("""
				{"answer":{"steps":[{"graph":{"patterns":[{"objects":[{"variable":"s","class":"/Sensor"}]}]},
				  "output":{"fields":[{"as":"count"}]}}]}}""");

		DslContractViolationException e = assertThrows(DslContractViolationException.class,
				() -> DslGrammarValidator.validate(dsl, CLASS_DEFS));

		assertEquals("steps[0].output.fields[0]", e.getViolations().get(0).getDslPath());
		assertTrue(e.getMessage().contains("variable") && e.getMessage().contains("field"), e.getMessage());
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
}
