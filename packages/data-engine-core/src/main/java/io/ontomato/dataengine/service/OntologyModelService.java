package io.ontomato.dataengine.service;

import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;

import com.fasterxml.jackson.databind.node.ObjectNode;

import io.ontomato.dataengine.core.bean.User;

/**
 * The ontology model's owning interface: the object-type, attribute and relationship pages and the agents read and
 * write the domain's rule through this service, never by rebuilding the stored shape themselves.
 */
public interface OntologyModelService {

	/** Attribute types shared by modeling, queries and storage adapters. */
	List<String> ATTRIBUTE_TYPES = List.of(
			"varchar", "int", "float", "datetime", "boolean", "text", "long", "double", "date", "timestamp", "vector");

	static String normalizeAttributeType(String type) {
		if (type == null) return null;
		String name = type.trim().toLowerCase(Locale.ROOT);
		return switch (name) {
			case "bigint", "int8" -> "long";
			case "integer", "int4", "smallint", "int2" -> "int";
			case "real", "float4" -> "float";
			case "double precision", "float8" -> "double";
			case "bool", "bit" -> "boolean";
			case "character varying", "nvarchar", "character", "char", "nchar" -> "varchar";
			case "datetime2" -> "datetime";
			case "timestamp without time zone", "timestamp with time zone", "timestamptz" -> "timestamp";
			default -> name;
		};
	}

	@SuppressWarnings("unchecked")
	static void normalizeRuleAttributeTypes(Map<String, Object> rule, boolean validate) {
		for (var definition : (List<Map<String, Object>>) rule.getOrDefault("classDef", List.of())) {
			for (var attribute : (List<Map<String, Object>>) definition.getOrDefault("attrs", List.of())) {
				String original = (String) attribute.get("type");
				String type = normalizeAttributeType(original);
				if (validate && (type == null || !ATTRIBUTE_TYPES.contains(type))) {
					throw new IllegalArgumentException("Unsupported attribute type for " + definition.get("className")
							+ "." + attribute.get("name") + ": " + original + ". Expected one of " + ATTRIBUTE_TYPES);
				}
				if (!Objects.equals(type, original)) attribute.put("type", type);
			}
		}
	}

	record ObjectTypeCreate(String className, String primaryKeyName, String showName, String classDesc) {
	}

	record ObjectTypeUpdate(String showName, String classDesc) {
	}

	record AttributeCreate(String name, String showName, String type, String attrDesc, Boolean enable,
			Boolean businessKey, Boolean primaryKey) {
	}

	record AttributeUpdate(String showName, String attrDesc, Boolean enable, Boolean businessKey) {
	}

	record RelationshipCreate(String relationship, String fromclass, String toclass, String desc, String fromField,
			String toField) {
	}

	record RelationshipUpdate(String desc, String fromField, String toField) {
	}

	record ObjectTypeView(String className, String showName, String classDesc, int attributeCount,
			int businessKeyCount, int relationshipCount, Map<String, Object> primaryKey,
			List<String> searchableAttributes) {
		public ObjectTypeView {
			searchableAttributes = searchableAttributes == null ? List.of() : List.copyOf(searchableAttributes);
		}
	}

	record AttributeView(String className, String name, String showName, String type, String attrDesc,
			boolean enable, boolean businessKey, boolean primaryKey) {
	}

	record RelationshipView(String relationship, String fromclass, String toclass, String desc, String fromField,
			String toField, String fromShowName, String toShowName) {
		public RelationshipView {
			fromShowName = fromShowName == null ? "" : fromShowName;
			toShowName = toShowName == null ? "" : toShowName;
		}
	}

	record DeletionImpact(List<RelationshipView> relationships) {
	}

	record ClassDeletion(List<String> relationships) {
	}

	/** A form's target as the panel contract sends it: an existing object by its primary key, or the create draft. */
	/** The owner's label of each field of the three model objects in the reader's language, by field key. */
	record FieldLabels(Map<String, String> objectType, Map<String, String> attribute,
			Map<String, String> relationship) {
	}

	record FormTarget(String kind, String objectType, String primaryKey) {
	}

	/** One form request: the target, its current values, and the field that changed (null when checking a draft). */
	record FormRequest(FormTarget target, Map<String, Object> values, String changedField) {
	}

	/** The request a form's save sends: the owner's endpoint and its body schema. */
	record FormSave(String method, String path, ObjectNode bodySchema) {
	}

	/** The whole form for one target: its fields, its current values and how a save writes them. */
	record FormDescription(List<ObjectNode> fields, Map<String, Object> values, FormSave save) {
	}

	List<ObjectTypeView> objectTypes(User user, String lang);

	ObjectTypeView objectType(String className, User user, String lang);

	List<AttributeView> attributes(String className, User user, String lang);

	List<RelationshipView> relationships(String className, User user, String lang);

	RelationshipView relationship(String relationship, User user, String lang);

	DeletionImpact deletionImpact(String className, User user, String lang);

	ObjectTypeView createObjectType(ObjectTypeCreate body, User user, String lang);

	ObjectTypeView updateObjectType(String className, ObjectTypeUpdate body, User user, String lang);

	ClassDeletion deleteObjectType(String className, User user, String lang);

	AttributeView createAttribute(String className, AttributeCreate body, User user, String lang);

	AttributeView updateAttribute(String className, String name, AttributeUpdate body, User user, String lang);

	List<AttributeView> setPrimaryKey(String className, String name, User user, String lang);

	void deleteAttribute(String className, String name, User user, String lang);

	RelationshipView createRelationship(RelationshipCreate body, User user, String lang);

	RelationshipView updateRelationship(String relationship, RelationshipUpdate body, User user, String lang);

	void deleteRelationship(String relationship, User user, String lang);

	FieldLabels fieldLabels(String lang);

	FormDescription objectTypeForm(FormRequest body, User user, String lang);

	FormDescription attributeForm(FormRequest body, User user, String lang);

	FormDescription relationshipForm(FormRequest body, User user, String lang);
}
