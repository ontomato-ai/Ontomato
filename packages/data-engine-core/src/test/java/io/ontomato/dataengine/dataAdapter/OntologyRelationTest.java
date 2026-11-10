package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.LinkedHashMap;
import java.util.Map;

import org.junit.jupiter.api.Test;

/**
 * The three relationship realizations, and the compatibility rule that keeps every ontomap written
 * before {@code type} existed readable.
 */
class OntologyRelationTest {

	private static final String WHERE = "relationship_rule[rel]";

	private static Map<String, Object> fk() {
		Map<String, Object> rule = new LinkedHashMap<>();
		rule.put("fromclass", "emp");
		rule.put("toclass", "dept");
		rule.put("type", "fk");
		rule.put("fromField", "dept_id");
		rule.put("toField", "id");
		return rule;
	}

	private static Map<String, Object> nn() {
		Map<String, Object> rule = new LinkedHashMap<>();
		rule.put("fromclass", "emp");
		rule.put("toclass", "dept");
		rule.put("type", "n:n");
		rule.put("fromField", "id");
		rule.put("toField", "id");
		rule.put("linkTable", "emp_dept_t");
		rule.put("linkTableFromField", "emp_id");
		rule.put("linkTableToField", "dept_id");
		return rule;
	}

	@Test
	void readsTheThreeDeclaredKinds() {
		OntologyRelation fk = OntologyRelation.of("rel", fk(), WHERE);
		assertEquals(OntologyRelation.KIND_FK, fk.kind());
		assertTrue(fk.usesKeyFields());
		assertFalse(fk.junction());

		Map<String, Object> graph = new LinkedHashMap<>();
		graph.put("fromclass", "emp");
		graph.put("toclass", "dept");
		graph.put("type", "graph");
		OntologyRelation edge = OntologyRelation.of("rel", graph, WHERE);
		assertEquals(OntologyRelation.KIND_GRAPH, edge.kind());
		assertFalse(edge.usesKeyFields(), "a graph edge reads no key field");

		OntologyRelation nn = OntologyRelation.of("rel", nn(), WHERE);
		assertEquals(OntologyRelation.KIND_NN, nn.kind());
		assertTrue(nn.junction());
		assertTrue(nn.usesKeyFields());
		assertEquals("emp_dept_t", nn.linkTable());
		assertEquals("emp_id", nn.linkTableFromField());
		assertEquals("dept_id", nn.linkTableToField());
	}

	/** Every ontomap written before {@code type} existed must keep its meaning. */
	@Test
	void infersTheKindWhenTypeIsAbsent() {
		Map<String, Object> withFields = fk();
		withFields.remove("type");
		assertEquals(OntologyRelation.KIND_FK, OntologyRelation.of("rel", withFields, WHERE).kind());

		Map<String, Object> withoutFields = new LinkedHashMap<>();
		withoutFields.put("fromclass", "emp");
		withoutFields.put("toclass", "dept");
		assertEquals(OntologyRelation.KIND_GRAPH, OntologyRelation.of("rel", withoutFields, WHERE).kind());

		Map<String, Object> blankFields = new LinkedHashMap<>();
		blankFields.put("fromclass", "emp");
		blankFields.put("toclass", "dept");
		blankFields.put("fromField", "");
		blankFields.put("toField", "");
		assertEquals(OntologyRelation.KIND_GRAPH, OntologyRelation.of("rel", blankFields, WHERE).kind(),
				"an empty join field is an absent one, as the modelling layer stores it");
	}

	@Test
	void infersJunctionFromItsTable() {
		Map<String, Object> rule = nn();
		rule.remove("type");
		OntologyRelation relation = OntologyRelation.of("rel", rule, WHERE);
		assertEquals(OntologyRelation.KIND_NN, relation.kind());
		assertTrue(relation.junction());
	}

	@Test
	void rejectsAnUnknownKind() {
		Map<String, Object> rule = fk();
		rule.put("type", "n2n");
		DslContractViolationException error = assertThrows(DslContractViolationException.class,
				() -> OntologyRelation.of("rel", rule, WHERE));
		assertEquals(DslContractViolationException.Code.UNSUPPORTED_CONSTRUCT,
				error.getViolations().get(0).getCode());
	}

	@Test
	void rejectsAnIncompleteJunction() {
		Map<String, Object> noTable = nn();
		noTable.remove("linkTable");
		assertThrows(DslContractViolationException.class, () -> OntologyRelation.of("rel", noTable, WHERE));

		Map<String, Object> noJunctionColumn = nn();
		noJunctionColumn.remove("linkTableToField");
		assertThrows(DslContractViolationException.class,
				() -> OntologyRelation.of("rel", noJunctionColumn, WHERE));

		Map<String, Object> noJoinField = nn();
		noJoinField.remove("fromField");
		assertThrows(DslContractViolationException.class,
				() -> OntologyRelation.of("rel", noJoinField, WHERE));

		Map<String, Object> sameColumn = nn();
		sameColumn.put("linkTableToField", "emp_id");
		assertThrows(DslContractViolationException.class,
				() -> OntologyRelation.of("rel", sameColumn, WHERE),
				"both ends cannot share one junction column");
	}

	@Test
	void rejectsAForeignKeyWithoutBothFields() {
		Map<String, Object> rule = fk();
		rule.remove("toField");
		assertThrows(DslContractViolationException.class, () -> OntologyRelation.of("rel", rule, WHERE));
	}

	@Test
	void rejectsAMissingDefinition() {
		assertThrows(DslContractViolationException.class, () -> OntologyRelation.of("rel", null, WHERE));
	}

	@Test
	void junctionColumnsAreAbsentOnAKeyFieldRelationship() {
		OntologyRelation fk = OntologyRelation.of("rel", fk(), WHERE);
		assertNull(fk.linkTable());
		assertNull(fk.linkTableFromField());
		assertNull(fk.linkTableToField());
	}

	@Test
	void namesTheFromEnd() {
		OntologyRelation relation = OntologyRelation.of("rel", nn(), WHERE);
		assertTrue(relation.fromEnd("emp"));
		assertFalse(relation.fromEnd("dept"));
	}
}
