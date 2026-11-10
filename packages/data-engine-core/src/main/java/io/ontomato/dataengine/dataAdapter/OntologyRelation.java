package io.ontomato.dataengine.dataAdapter;

import java.util.Map;

/**
 * One ontology relationship resolved to its physical realization.
 *
 * <p>The ontomap's {@code relationship_rule} entry says how the relationship is stored, and every
 * adapter reads it through this one class so the three kinds keep a single meaning:</p>
 *
 * <dl>
 * <dt>{@code graph}</dt><dd>the source holds real edges (Neo4j, M3); no join fields.</dd>
 * <dt>{@code fk}</dt><dd>one end stores the other's key in a column: {@code fromField} on the
 * from-class points at {@code toField} on the to-class.</dd>
 * <dt>{@code n:n}</dt><dd>a junction table holds both keys; both classes are joined through it.</dd>
 * </dl>
 *
 * <p><b>An entry without {@code type} is still legal and is inferred</b>: join fields present means
 * {@code fk}, absent means {@code graph}. Every ontomap written before this field existed keeps its
 * meaning, which is why inference is not a convenience but the compatibility rule.</p>
 *
 * <p>Field names all point the same way, so a modelling mistake is caught rather than absorbed:
 * {@code linkTableFromField} is the junction column holding the <em>from</em> class's key.</p>
 */
public final class OntologyRelation {

	/** The source holds real edges; there is no key field and no junction table. */
	public static final String KIND_GRAPH = "graph";

	/** A key column on one end points at the other end's key. */
	public static final String KIND_FK = "fk";

	/** A junction table holds both keys. */
	public static final String KIND_NN = "n:n";

	private final String name;
	private final String kind;
	private final String fromClass;
	private final String toClass;
	private final String fromField;
	private final String toField;
	private final String linkTable;
	private final String linkTableFromField;
	private final String linkTableToField;

	private OntologyRelation(String name, String kind, String fromClass, String toClass, String fromField,
			String toField, String linkTable, String linkTableFromField, String linkTableToField) {
		this.name = name;
		this.kind = kind;
		this.fromClass = fromClass;
		this.toClass = toClass;
		this.fromField = fromField;
		this.toField = toField;
		this.linkTable = linkTable;
		this.linkTableFromField = linkTableFromField;
		this.linkTableToField = linkTableToField;
	}

	/**
	 * Resolve one relationship, or throw when the entry cannot be executed.
	 *
	 * @param name the relationship name as the DSL and the ontomap key it by
	 * @param definition the {@code relationship_rule} entry
	 * @param where the locator used in a contract violation, e.g. {@code relationship_rule[works_at]}
	 */
	@SuppressWarnings("unchecked")
	public static OntologyRelation of(String name, Object definition, String where) {
		if (!(definition instanceof Map)) {
			throw violation(where, "relationship '" + name + "' has no definition");
		}
		Map<String, Object> rule = (Map<String, Object>) definition;
		String kind = text(rule.get("type"));
		if (kind == null) {
			kind = inferKind(rule, where);
		} else if (!KIND_GRAPH.equals(kind) && !KIND_FK.equals(kind) && !KIND_NN.equals(kind)) {
			throw violation(where, "relationship '" + name + "' has unknown type '" + kind
					+ "'; expected one of " + KIND_GRAPH + ", " + KIND_FK + ", " + KIND_NN);
		}

		OntologyRelation relation = new OntologyRelation(name, kind,
				text(rule.get("fromclass")), text(rule.get("toclass")),
				text(rule.get("fromField")), text(rule.get("toField")),				text(rule.get("linkTable")), text(rule.get("linkTableFromField")),
				text(rule.get("linkTableToField")));
		relation.validate(where);
		return relation;
	}

	/**
	 * A relationship with no {@code type} keeps the meaning it had before the field existed: join
	 * fields make it a foreign key, their absence makes it a graph edge.
	 */
	private static String inferKind(Map<String, Object> rule, String where) {
		if (text(rule.get("linkTable")) != null) {
			return KIND_NN;
		}
		String fromField = text(rule.get("fromField"));
		String toField = text(rule.get("toField"));
		if (isBlank(fromField) || isBlank(toField)) {
			return KIND_GRAPH;
		}
		return KIND_FK;
	}

	private void validate(String where) {
		if (isBlank(fromClass) || isBlank(toClass)) {
			throw violation(where, "relationship '" + name + "' must name both fromclass and toclass");
		}
		if (KIND_NN.equals(kind)) {
			if (isBlank(linkTable)) {
				throw violation(where, "relationship '" + name + "' is n:n but has no linkTable");
			}
			if (isBlank(linkTableFromField) || isBlank(linkTableToField)) {
				throw violation(where, "relationship '" + name + "' is n:n but does not name both junction columns"
						+ " (linkTableFromField holds the " + fromClass + " key, linkTableToField the " + toClass + " key)");
			}
			if (isBlank(fromField) || isBlank(toField)) {
				throw violation(where, "relationship '" + name + "' is n:n but does not name both join fields"
						+ " (fromField on " + fromClass + ", toField on " + toClass + ")");
			}
			if (linkTableFromField.equals(linkTableToField)) {
				throw violation(where, "relationship '" + name + "' is n:n but names the same junction column ("
						+ linkTableFromField + ") for both ends");
			}
		}
		if (KIND_FK.equals(kind) && (isBlank(fromField) || isBlank(toField))) {
			throw violation(where, "relationship '" + name + "' is fk but does not name both fromField and toField");
		}
	}

	/** The relationship name, unique across the ontomap. */
	public String name() {
		return name;
	}

	/** One of {@link #KIND_GRAPH}, {@link #KIND_FK}, {@link #KIND_NN}. */
	public String kind() {
		return kind;
	}

	public String fromClass() {
		return fromClass;
	}

	public String toClass() {
		return toClass;
	}

	/** The from-class column that takes part in the join. */
	public String fromField() {
		return fromField;
	}

	/** The to-class column that takes part in the join. */
	public String toField() {
		return toField;
	}

	/** The junction table of an {@code n:n} relationship; {@code null} otherwise. */
	public String linkTable() {
		return linkTable;
	}

	/** The junction column holding the from-class key; {@code null} unless {@code n:n}. */
	public String linkTableFromField() {
		return linkTableFromField;
	}

	/** The junction column holding the to-class key; {@code null} unless {@code n:n}. */
	public String linkTableToField() {
		return linkTableToField;
	}

	/** Whether this relationship is realised through a junction table. */
	public boolean junction() {
		return KIND_NN.equals(kind);
	}

	/** Whether this relationship needs key fields at all (a graph edge reads neither). */
	public boolean usesKeyFields() {
		return !KIND_GRAPH.equals(kind);
	}

	/**
	 * Whether {@code className} is the from end of this relationship. A relationship is declared in
	 * one direction only, and a DSL may traverse it either way, so every adapter asks this before
	 * choosing which side supplies which column.
	 */
	public boolean fromEnd(String className) {
		return fromClass != null && fromClass.equals(className);
	}

	private static String text(Object value) {
		if (value == null) {
			return null;
		}
		String text = value.toString().trim();
		return text.isEmpty() ? null : text;
	}

	private static boolean isBlank(String value) {
		return value == null || value.trim().isEmpty();
	}

	private static DslContractViolationException violation(String where, String message) {
		return new DslContractViolationException(
				DslContractViolationException.Code.UNSUPPORTED_CONSTRUCT, where, message);
	}
}
