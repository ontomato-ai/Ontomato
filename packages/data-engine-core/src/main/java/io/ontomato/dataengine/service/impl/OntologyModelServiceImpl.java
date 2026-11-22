package io.ontomato.dataengine.service.impl;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import cn.hutool.core.lang.UUID;

import io.ontomato.dataengine.bean.AuditLog;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.AuditLogDao;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.schedules.ScheduleJson;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.FormFields;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.OntologyModelException;
import io.ontomato.dataengine.service.OntologyModelService;

import static io.ontomato.dataengine.schedules.ScheduleJson.object;

/**
 * Reads and writes the domain's ontology through {@link AdminService#getJSONRule} and
 * {@link AdminService#writeJSONRule}, so one operation is one saved rule and the existing whole-model primary-key
 * check still guards every write.
 */
@Service
public class OntologyModelServiceImpl implements OntologyModelService {

	private static final String NAME_PATTERN = "[A-Za-z_][A-Za-z0-9_]*";

	@Autowired
	private AdminService adminService;

	@Autowired
	private DataAdapterRegistry dataAdapterRegistry;

	@Autowired
	private BusinessConfigService businessConfigService;

	@Autowired
	private LangService langService;

	@Autowired
	private AuditLogDao auditLogDao;

	@Override
	public List<ObjectTypeView> objectTypes(User user, String lang) {
		Map<String, Object> rule = rule(user);
		Map<String, Map<String, String>> relationships = relationships(rule);
		return classDefs(rule).stream().map(classDef -> objectTypeView(classDef, relationships)).toList();
	}

	@Override
	public ObjectTypeView objectType(String className, User user, String lang) {
		Map<String, Object> rule = rule(user);
		Map<String, Object> classDef = requireClass(rule, className, lang);
		return objectTypeView(classDef, relationships(rule));
	}

	@Override
	public List<AttributeView> attributes(String className, User user, String lang) {
		Map<String, Object> rule = rule(user);
		List<Map<String, Object>> classDefs = classDefs(rule);
		if (!blank(className)) {
			return attrs(requireClass(rule, className, lang)).stream()
					.map(attr -> attributeView(className, attr)).toList();
		}
		List<AttributeView> result = new ArrayList<>();
		for (Map<String, Object> classDef : classDefs) {
			String owner = (String) classDef.get("className");
			for (Map<String, Object> attr : attrs(classDef)) {
				result.add(attributeView(owner, attr));
			}
		}
		return result;
	}

	@Override
	public List<RelationshipView> relationships(String className, User user, String lang) {
		Map<String, Object> rule = rule(user);
		Map<String, Map<String, String>> relationships = relationships(rule);
		Map<String, String> classShowNames = classShowNames(rule);
		List<RelationshipView> result = new ArrayList<>();
		for (Map.Entry<String, Map<String, String>> entry : relationships.entrySet()) {
			Map<String, String> def = entry.getValue();
			if (blank(className) || className.equals(def.get("fromclass")) || className.equals(def.get("toclass"))) {
				result.add(relationshipView(entry.getKey(), def, classShowNames));
			}
		}
		return result;
	}

	@Override
	public RelationshipView relationship(String relationship, User user, String lang) {
		Map<String, Object> rule = rule(user);
		Map<String, String> def = relationships(rule).get(relationship);
		if (def == null) {
			throw relationshipNotFound(lang);
		}
		return relationshipView(relationship, def, classShowNames(rule));
	}

	@Override
	public DeletionImpact deletionImpact(String className, User user, String lang) {
		Map<String, Object> rule = rule(user);
		requireClass(rule, className, lang);
		return new DeletionImpact(cascadingRelationships(rule, className));
	}

	@Override
	public ObjectTypeView createObjectType(ObjectTypeCreate raw, User user, String lang) {
		Map<String, Object> rule = rule(user);
		ObjectTypeCreate body = checkedObjectTypeCreate(rule, user, raw, lang).body();

		Map<String, Object> primaryKey = new HashMap<>();
		primaryKey.put("name", body.primaryKeyName());
		primaryKey.put("showName", body.primaryKeyName());
		primaryKey.put("attrDesc", "");
		primaryKey.put("type", "varchar");
		primaryKey.put("bizzkey", false);
		primaryKey.put("enable", true);
		primaryKey.put("primaryKey", true);
		List<Map<String, Object>> attrs = new ArrayList<>();
		attrs.add(primaryKey);

		Map<String, Object> classDef = new HashMap<>();
		classDef.put("className", body.className());
		classDef.put("showName", body.showName());
		classDef.put("classDesc", body.classDesc());
		classDef.put("classToCard", false);
		classDef.put("instanceToCard", false);
		classDef.put("inStarChart", false);
		classDef.put("attrs", attrs);
		classDefs(rule).add(classDef);
		classList(rule).add(body.className());
		write(user, rule);
		audit(user, AuditLog.OPERATION_ADD, description(user, "AuditLog.class.add", body.className()),
				com.alibaba.fastjson2.JSONObject.toJSONString(classDef));
		return objectTypeView(classDef, relationships(rule));
	}

	@Override
	public ObjectTypeView updateObjectType(String className, ObjectTypeUpdate raw, User user, String lang) {
		Map<String, Object> rule = rule(user);
		CheckedObjectTypeUpdate checked = checkedObjectTypeUpdate(rule, className, raw, user, lang);

		checked.classDef().put("showName", checked.body().showName());
		checked.classDef().put("classDesc", checked.body().classDesc());
		write(user, rule);
		audit(user, AuditLog.OPERATION_UPD, description(user, "AuditLog.class.upd", checked.className()),
				com.alibaba.fastjson2.JSONObject.toJSONString(checked.classDef()));
		return objectTypeView(checked.classDef(), relationships(rule));
	}

	@Override
	public ClassDeletion deleteObjectType(String className, User user, String lang) {
		Map<String, Object> rule = rule(user);
		String owner = trim(className);
		List<ObjectNode> errors = new ArrayList<>();
		required(errors, "className", owner, langService.get(lang, "Admin.class.nameRequired"));
		fail(errors, lang);
		requireClass(rule, owner, lang);
		List<RelationshipView> impact = cascadingRelationships(rule, owner);
		List<String> names = impact.stream().map(RelationshipView::relationship).toList();

		classDefs(rule).removeIf(classDef -> owner.equals(classDef.get("className")));
		classList(rule).remove(owner);
		Map<String, Map<String, String>> relationships = relationships(rule);
		for (String name : names) {
			relationships.remove(name);
		}
		write(user, rule);

		audit(user, AuditLog.OPERATION_DEL, description(user, "AuditLog.class.del", owner), owner);
		for (String name : names) {
			audit(user, AuditLog.OPERATION_DEL, description(user, "AuditLog.relationship.del", name), name);
		}
		return new ClassDeletion(names);
	}

	@Override
	public AttributeView createAttribute(String className, AttributeCreate raw, User user, String lang) {
		Map<String, Object> rule = rule(user);
		CheckedAttributeCreate checked = checkedAttributeCreate(rule, className, raw, user, lang);
		AttributeCreate body = checked.body();
		List<Map<String, Object>> attrs = attrs(checked.classDef());

		Map<String, Object> attrDef = new HashMap<>();
		attrDef.put("name", body.name());
		attrDef.put("showName", body.showName());
		attrDef.put("attrDesc", body.attrDesc());
		attrDef.put("type", body.type());
		attrDef.put("bizzkey", Boolean.TRUE.equals(body.businessKey()));
		attrDef.put("enable", body.enable());
		attrDef.put("primaryKey", Boolean.TRUE.equals(body.primaryKey()));
		if (Boolean.TRUE.equals(body.primaryKey())) {
			for (Map<String, Object> attr : attrs) {
				attr.put("primaryKey", false);
			}
		}
		attrs.add(attrDef);
		write(user, rule);
		audit(user, AuditLog.OPERATION_UPD,
				description(user, "AuditLog.class", checked.className()) + ", "
						+ langService.get(sysLang(user), "AuditLog.attr.add") + ": " + body.name(),
				com.alibaba.fastjson2.JSONObject.toJSONString(attrDef));
		return attributeView(checked.className(), attrDef);
	}

	@Override
	public AttributeView updateAttribute(String className, String name, AttributeUpdate raw, User user, String lang) {
		Map<String, Object> rule = rule(user);
		CheckedAttributeUpdate checked = checkedAttributeUpdate(rule, className, name, raw, user, lang);

		checked.attrDef().put("showName", checked.body().showName());
		checked.attrDef().put("attrDesc", checked.body().attrDesc());
		checked.attrDef().put("enable", checked.body().enable());
		checked.attrDef().put("bizzkey", Boolean.TRUE.equals(checked.body().businessKey()));
		write(user, rule);
		audit(user, AuditLog.OPERATION_UPD,
				description(user, "AuditLog.class", checked.className()) + ", "
						+ langService.get(sysLang(user), "AuditLog.attr.upd") + ": " + checked.name(),
				com.alibaba.fastjson2.JSONObject.toJSONString(checked.attrDef()));
		return attributeView(checked.className(), checked.attrDef());
	}

	@Override
	public List<AttributeView> setPrimaryKey(String className, String name, User user, String lang) {
		Map<String, Object> rule = rule(user);
		String owner = trim(className);
		String attrName = trim(name);
		List<ObjectNode> errors = new ArrayList<>();
		required(errors, "className", owner, langService.get(lang, "Admin.class.nameRequired"));
		required(errors, "name", attrName, langService.get(lang, "Admin.attr.nameRequired"));
		fail(errors, lang);
		Map<String, Object> classDef = requireClass(rule, owner, lang);
		Map<String, Object> target = requireAttribute(classDef, attrName, lang);
		if (!"varchar".equals(target.get("type")) || !enabled(target.get("enable"))) {
			errors.add(field("name", "invalid_option", langService.get(lang, "Admin.attr.primaryKeyInvalid")));
		}
		validateName(attrName, errors, "name", lang, "Admin.attr.formatError");
		if (errors.stream().noneMatch(error -> "name".equals(fieldName(error)))) {
			try {
				adapter(user, rule).validatePrimaryKeyName(attrName);
			} catch (Exception error) {
				errors.add(field("name", "invalid_format", error.getMessage()));
			}
		}
		fail(errors, lang);

		List<Map<String, Object>> attrs = attrs(classDef);
		for (Map<String, Object> attr : attrs) {
			attr.put("primaryKey", attr == target);
		}
		write(user, rule);
		return attrs.stream().map(attr -> attributeView(owner, attr)).toList();
	}

	@Override
	public void deleteAttribute(String className, String name, User user, String lang) {
		Map<String, Object> rule = rule(user);
		String owner = trim(className);
		String attrName = trim(name);
		List<ObjectNode> errors = new ArrayList<>();
		required(errors, "className", owner, langService.get(lang, "Admin.class.nameRequired"));
		required(errors, "name", attrName, langService.get(lang, "Admin.attr.nameRequired"));
		fail(errors, lang);
		Map<String, Object> classDef = requireClass(rule, owner, lang);
		Map<String, Object> attrDef = requireAttribute(classDef, attrName, lang);
		if (booleanValue(attrDef.get("primaryKey"))) {
			throw OntologyModelException.conflict("PRIMARY_KEY_LOCKED",
					langService.get(lang, "Admin.attr.primaryKeyLocked"), Map.of());
		}
		List<String> usedBy = usingRelationships(rule, owner, attrName);
		if (!usedBy.isEmpty()) {
			throw OntologyModelException.conflict("ATTRIBUTE_IN_USE",
					langService.get(lang, "Admin.attr.inUse") + ": " + String.join(", ", usedBy),
					Map.of("relationships", usedBy));
		}

		attrs(classDef).removeIf(attr -> attrName.equals(attr.get("name")));
		write(user, rule);
		audit(user, AuditLog.OPERATION_UPD,
				description(user, "AuditLog.class", owner) + ", "
						+ langService.get(sysLang(user), "AuditLog.attr.del") + ": " + attrName,
				owner + "    " + attrName);
	}

	@Override
	public RelationshipView createRelationship(RelationshipCreate raw, User user, String lang) {
		Map<String, Object> rule = rule(user);
		RelationshipCreate body = checkedRelationshipCreate(rule, user, raw, lang).body();

		Map<String, String> relationshipDef = new HashMap<>();
		relationshipDef.put("fromclass", body.fromclass());
		relationshipDef.put("toclass", body.toclass());
		relationshipDef.put("desc", body.desc());
		relationshipDef.put("fromField", body.fromField());
		relationshipDef.put("toField", body.toField());
		relationshipDef.put("fromdesc", "");
		relationshipDef.put("todesc", "");
		relationships(rule).put(body.relationship(), relationshipDef);
		write(user, rule);
		audit(user, AuditLog.OPERATION_ADD, description(user, "AuditLog.relationship.add", body.relationship()),
				com.alibaba.fastjson2.JSONObject.toJSONString(relationshipDef));
		return relationshipView(body.relationship(), relationshipDef, classShowNames(rule));
	}

	@Override
	public RelationshipView updateRelationship(String relationship, RelationshipUpdate raw, User user, String lang) {
		Map<String, Object> rule = rule(user);
		CheckedRelationshipUpdate checked = checkedRelationshipUpdate(rule, relationship, raw, user, lang);

		checked.relationshipDef().put("desc", checked.body().desc());
		checked.relationshipDef().put("fromField", checked.body().fromField());
		checked.relationshipDef().put("toField", checked.body().toField());
		write(user, rule);
		audit(user, AuditLog.OPERATION_UPD, description(user, "AuditLog.relationship.upd", checked.relationship()),
				com.alibaba.fastjson2.JSONObject.toJSONString(checked.relationshipDef()));
		return relationshipView(checked.relationship(), checked.relationshipDef(), classShowNames(rule));
	}

	@Override
	public void deleteRelationship(String relationship, User user, String lang) {
		Map<String, Object> rule = rule(user);
		String name = trim(relationship);
		List<ObjectNode> errors = new ArrayList<>();
		required(errors, "relationship", name, langService.get(lang, "Admin.relationship.nameRequired"));
		fail(errors, lang);
		if (relationships(rule).remove(name) == null) {
			throw relationshipNotFound(lang);
		}
		write(user, rule);
		audit(user, AuditLog.OPERATION_DEL, description(user, "AuditLog.relationship.del", name), name);
	}

	@Override
	public FieldLabels fieldLabels(String lang) {
		return new FieldLabels(labels(OBJECT_TYPE_LABEL_KEYS, lang), labels(ATTRIBUTE_LABEL_KEYS, lang),
				labels(RELATIONSHIP_LABEL_KEYS, lang));
	}

	@Override
	public FormDescription objectTypeForm(FormRequest body, User user, String lang) {
		Map<String, Object> rule = rule(user);
		boolean edit = editTarget(body);
		String className = trim(body.target().primaryKey());
		Map<String, Object> classDef = edit ? requireClass(rule, className, lang) : null;
		Map<String, Object> current = edit
				? objectTypeValues(text(classDef.get("className")), null, text(classDef.get("showName")),
						text(classDef.get("classDesc")))
				: objectTypeValues("", "", "", "");
		Map<String, Object> values = formValues(body, current);
		if (draftToCheck(body)) {
			values = edit
					? draftObjectTypeUpdate(rule, className, values, user, lang)
					: draftObjectTypeCreate(rule, values, user, lang);
		}
		return new FormDescription(objectTypeFields(edit, lang), values, objectTypeFormSave(edit, lang));
	}

	@Override
	public FormDescription attributeForm(FormRequest body, User user, String lang) {
		Map<String, Object> rule = rule(user);
		boolean edit = editTarget(body);
		String[] key = edit ? attributeKey(body.target().primaryKey()) : null;
		Map<String, Object> attrDef = edit ? requireAttribute(requireClass(rule, key[0], lang), key[1], lang) : null;
		Map<String, Object> current = edit
				? attributeValues(key[0], key[1], text(attrDef.get("type")), text(attrDef.get("showName")),
						text(attrDef.get("attrDesc")), enabled(attrDef.get("enable")), businessKey(attrDef),
						primaryKey(attrDef))
				: attributeValues("", "", "", "", "", true, false, false);
		Map<String, Object> values = formValues(body, current);
		if (draftToCheck(body)) {
			values = edit ? draftAttributeUpdate(rule, key, values, user, lang) : draftAttributeCreate(rule, values, user, lang);
		}
		return new FormDescription(attributeFields(rule, edit, attrDef, lang), values, attributeFormSave(edit, lang));
	}

	@Override
	public FormDescription relationshipForm(FormRequest body, User user, String lang) {
		Map<String, Object> rule = rule(user);
		boolean edit = editTarget(body);
		String relationship = trim(body.target().primaryKey());
		Map<String, String> def = edit ? requireRelationship(rule, relationship, lang) : null;
		Map<String, Object> current = edit
				? relationshipValues(relationship, text(def.get("fromclass")), text(def.get("fromField")),
						text(def.get("toclass")), text(def.get("toField")), text(def.get("desc")))
				: relationshipValues("", "", "", "", "", "");
		Map<String, Object> values = formValues(body, current);
		if (body.changedField() != null) {
			// A changed end class offers its own attributes; a value held for the class before is no longer one of them.
			values.put("fromField", joinField(rule, formString(values, "fromclass"), formString(values, "fromField")));
			values.put("toField", joinField(rule, formString(values, "toclass"), formString(values, "toField")));
		}
		if (draftToCheck(body)) {
			values = edit
					? draftRelationshipUpdate(rule, relationship, values, user, lang)
					: draftRelationshipCreate(rule, values, user, lang);
		}
		return new FormDescription(relationshipFields(rule, edit, values, user, lang), values,
				relationshipFormSave(edit, joinFieldsRequired(user), lang));
	}

	private Map<String, Object> rule(User user) {
		return adminService.getJSONRule(user.getDomainId());
	}

	private void write(User user, Map<String, Object> rule) {
		adminService.writeJSONRule(rule, user.getDomainId());
	}

	private BusinessConfig businessConfig(User user) {
		return businessConfigService.get(user.getDomainId());
	}

	private String sysLang(User user) {
		return businessConfig(user).getLang();
	}

	private DataAdapter adapter(User user, Map<String, Object> rule) {
		return dataAdapterRegistry.create(businessConfig(user), rule);
	}

	@SuppressWarnings("unchecked")
	private static List<Map<String, Object>> classDefs(Map<String, Object> rule) {
		return (List<Map<String, Object>>) rule.get("classDef");
	}

	@SuppressWarnings("unchecked")
	private static List<String> classList(Map<String, Object> rule) {
		return (List<String>) rule.get("classlist");
	}

	@SuppressWarnings("unchecked")
	private static Map<String, Map<String, String>> relationships(Map<String, Object> rule) {
		return (Map<String, Map<String, String>>) rule.get("relationship_rule");
	}

	@SuppressWarnings("unchecked")
	private static List<Map<String, Object>> attrs(Map<String, Object> classDef) {
		return (List<Map<String, Object>>) classDef.get("attrs");
	}

	private static Map<String, Object> findClass(List<Map<String, Object>> classDefs, String className) {
		for (Map<String, Object> classDef : classDefs) {
			if (className.equals(classDef.get("className"))) {
				return classDef;
			}
		}
		return null;
	}

	private Map<String, Object> requireClass(Map<String, Object> rule, String className, String lang) {
		Map<String, Object> classDef = findClass(classDefs(rule), className);
		if (classDef == null) {
			throw OntologyModelException.notFound("OBJECT_TYPE_NOT_FOUND",
					langService.get(lang, "Admin.class.notFound"));
		}
		return classDef;
	}

	private Map<String, Object> requireAttribute(Map<String, Object> classDef, String name, String lang) {
		for (Map<String, Object> attr : attrs(classDef)) {
			if (name.equals(attr.get("name"))) {
				return attr;
			}
		}
		throw OntologyModelException.notFound("ATTRIBUTE_NOT_FOUND", langService.get(lang, "Admin.attr.notFound"));
	}

	private OntologyModelException relationshipNotFound(String lang) {
		return OntologyModelException.notFound("RELATIONSHIP_NOT_FOUND",
				langService.get(lang, "Admin.relationship.notFound"));
	}

	private Map<String, String> requireRelationship(Map<String, Object> rule, String relationship, String lang) {
		Map<String, String> def = relationships(rule).get(relationship);
		if (def == null) {
			throw relationshipNotFound(lang);
		}
		return def;
	}

	/*
	 * The six save checks, each in one place: the write it belongs to runs it, and a form's draft check runs the same
	 * one without writing. Each returns the normalized body together with the rule state the write needs.
	 */

	private record CheckedObjectTypeCreate(ObjectTypeCreate body) {
	}

	private record CheckedObjectTypeUpdate(String className, Map<String, Object> classDef, ObjectTypeUpdate body) {
	}

	private record CheckedAttributeCreate(String className, Map<String, Object> classDef, AttributeCreate body) {
	}

	private record CheckedAttributeUpdate(String className, String name, Map<String, Object> attrDef,
			AttributeUpdate body) {
	}

	private record CheckedRelationshipCreate(RelationshipCreate body) {
	}

	private record CheckedRelationshipUpdate(String relationship, Map<String, String> relationshipDef,
			RelationshipUpdate body) {
	}

	private CheckedObjectTypeCreate checkedObjectTypeCreate(Map<String, Object> rule, User user, ObjectTypeCreate raw,
			String lang) {
		List<ObjectNode> errors = new ArrayList<>();
		String className = trim(raw.className());
		String primaryKeyName = trim(raw.primaryKeyName());
		String showName = trim(raw.showName());
		String classDesc = trim(raw.classDesc());

		required(errors, "className", className, langService.get(lang, "Admin.class.nameRequired"));
		required(errors, "primaryKeyName", primaryKeyName, langService.get(lang, "Admin.class.primaryKeyRequired"));
		required(errors, "showName", showName, langService.get(lang, "Admin.class.nameRequired"));
		if (!blank(className) && findClass(classDefs(rule), className) != null) {
			errors.add(field("className", "already_exists", langService.get(lang, "Admin.class.exist")));
		}
		DataAdapter adapter = adapter(user, rule);
		if (!blank(className)) {
			validateClassName(adapter, className, errors, lang);
		}
		if (!blank(primaryKeyName)) {
			validateName(primaryKeyName, errors, "primaryKeyName", lang, "Admin.attr.formatError");
			if (errors.stream().noneMatch(error -> "primaryKeyName".equals(fieldName(error)))) {
				try {
					adapter.validatePrimaryKeyName(primaryKeyName);
				} catch (Exception error) {
					errors.add(field("primaryKeyName", "invalid_format", error.getMessage()));
				}
			}
		}
		fail(errors, lang);
		return new CheckedObjectTypeCreate(new ObjectTypeCreate(className, primaryKeyName, showName, classDesc));
	}

	private CheckedObjectTypeUpdate checkedObjectTypeUpdate(Map<String, Object> rule, String className,
			ObjectTypeUpdate raw, User user, String lang) {
		String owner = trim(className);
		List<ObjectNode> errors = new ArrayList<>();
		String showName = trim(raw.showName());
		String classDesc = trim(raw.classDesc());
		required(errors, "className", owner, langService.get(lang, "Admin.class.nameRequired"));
		required(errors, "showName", showName, langService.get(lang, "Admin.class.nameRequired"));
		fail(errors, lang);
		return new CheckedObjectTypeUpdate(owner, requireClass(rule, owner, lang),
				new ObjectTypeUpdate(showName, classDesc));
	}

	private CheckedAttributeCreate checkedAttributeCreate(Map<String, Object> rule, String className,
			AttributeCreate raw, User user, String lang) {
		String owner = trim(className);
		List<ObjectNode> errors = new ArrayList<>();
		required(errors, "className", owner, langService.get(lang, "Admin.class.nameRequired"));
		Map<String, Object> classDef = blank(owner) ? null : findClass(classDefs(rule), owner);
		List<Map<String, Object>> attrs = classDef == null ? List.of() : attrs(classDef);
		String name = trim(raw.name());
		String showName = trim(raw.showName());
		String type = trim(raw.type());
		String attrDesc = trim(raw.attrDesc());

		required(errors, "name", name, langService.get(lang, "Admin.attr.nameRequired"));
		required(errors, "showName", showName, langService.get(lang, "Admin.attr.showNameRequired"));
		required(errors, "type", type, langService.get(lang, "Admin.attr.typeRequired"));
		required(errors, "enable", raw.enable(), langService.get(lang, "Admin.field.booleanRequired"));
		required(errors, "businessKey", raw.businessKey(), langService.get(lang, "Admin.field.booleanRequired"));
		if (!blank(name)) {
			validateName(name, errors, "name", lang, "Admin.attr.formatError");
			if (attrs.stream().anyMatch(attr -> name.equals(attr.get("name")))) {
				errors.add(field("name", "already_exists", langService.get(lang, "Admin.attr.exist")));
			}
		}
		if (!blank(type) && !ATTRIBUTE_TYPES.contains(type)) {
			errors.add(field("type", "invalid_option", langService.get(lang, "Admin.attr.typeError")));
		}
		boolean primaryKey = Boolean.TRUE.equals(raw.primaryKey());
		if (primaryKey && ATTRIBUTE_TYPES.contains(type) && !"varchar".equals(type)) {
			errors.add(field("type", "invalid_option", langService.get(lang, "Admin.attr.primaryKeyInvalid")));
		}
		if (primaryKey && Boolean.FALSE.equals(raw.enable())) {
			errors.add(field("enable", "invalid_option", langService.get(lang, "Admin.attr.primaryKeyInvalid")));
		}
		if (primaryKey && !blank(name)) {
			if (errors.stream().noneMatch(error -> "name".equals(fieldName(error)))) {
				try {
					adapter(user, rule).validatePrimaryKeyName(name);
				} catch (Exception error) {
					errors.add(field("name", "invalid_format", error.getMessage()));
				}
			}
		}
		fail(errors, lang);
		return new CheckedAttributeCreate(owner, requireClass(rule, owner, lang),
				new AttributeCreate(name, showName, type, attrDesc, raw.enable(), raw.businessKey(), primaryKey));
	}

	private CheckedAttributeUpdate checkedAttributeUpdate(Map<String, Object> rule, String className, String name,
			AttributeUpdate raw, User user, String lang) {
		String owner = trim(className);
		String attrName = trim(name);
		List<ObjectNode> errors = new ArrayList<>();
		String showName = trim(raw.showName());
		String attrDesc = trim(raw.attrDesc());
		required(errors, "className", owner, langService.get(lang, "Admin.class.nameRequired"));
		required(errors, "name", attrName, langService.get(lang, "Admin.attr.nameRequired"));
		required(errors, "showName", showName, langService.get(lang, "Admin.attr.showNameRequired"));
		required(errors, "enable", raw.enable(), langService.get(lang, "Admin.field.booleanRequired"));
		required(errors, "businessKey", raw.businessKey(), langService.get(lang, "Admin.field.booleanRequired"));
		fail(errors, lang);
		Map<String, Object> classDef = requireClass(rule, owner, lang);
		Map<String, Object> attrDef = requireAttribute(classDef, attrName, lang);
		if (Boolean.FALSE.equals(raw.enable()) && booleanValue(attrDef.get("primaryKey"))) {
			throw OntologyModelException.conflict("PRIMARY_KEY_LOCKED",
					langService.get(lang, "Admin.attr.primaryKeyLocked"), Map.of());
		}
		return new CheckedAttributeUpdate(owner, attrName, attrDef,
				new AttributeUpdate(showName, attrDesc, raw.enable(), raw.businessKey()));
	}

	private CheckedRelationshipCreate checkedRelationshipCreate(Map<String, Object> rule, User user,
			RelationshipCreate raw, String lang) {
		List<ObjectNode> errors = new ArrayList<>();
		String relationship = trim(raw.relationship());
		String fromclass = trim(raw.fromclass());
		String toclass = trim(raw.toclass());
		String desc = trim(raw.desc());
		String fromField = trim(raw.fromField());
		String toField = trim(raw.toField());

		required(errors, "relationship", relationship, langService.get(lang, "Admin.relationship.nameRequired"));
		required(errors, "fromclass", fromclass, langService.get(lang, "Admin.relationship.fromClassRequired"));
		required(errors, "toclass", toclass, langService.get(lang, "Admin.relationship.toClassRequired"));
		required(errors, "desc", desc, langService.get(lang, "Admin.relationship.descRequired"));
		if (!blank(relationship)) {
			validateName(relationship, errors, "relationship", lang, "Admin.relationship.nameError");
			if (relationships(rule).containsKey(relationship)) {
				errors.add(field("relationship", "already_exists", langService.get(lang, "Admin.relationship.exist")));
			}
		}
		Map<String, Object> fromClass = blank(fromclass) ? null : findClass(classDefs(rule), fromclass);
		Map<String, Object> toClass = blank(toclass) ? null : findClass(classDefs(rule), toclass);
		if (!blank(fromclass) && fromClass == null) {
			errors.add(field("fromclass", "invalid_option", langService.get(lang, "Admin.relationship.fromClassNotFound")));
		}
		if (!blank(toclass) && toClass == null) {
			errors.add(field("toclass", "invalid_option", langService.get(lang, "Admin.relationship.toClassNotFound")));
		}
		validateJoinFields(user, errors, lang, fromClass, toClass, fromField, toField);
		fail(errors, lang);
		return new CheckedRelationshipCreate(
				new RelationshipCreate(relationship, fromclass, toclass, desc, fromField, toField));
	}

	private CheckedRelationshipUpdate checkedRelationshipUpdate(Map<String, Object> rule, String relationship,
			RelationshipUpdate raw, User user, String lang) {
		String name = trim(relationship);
		List<ObjectNode> errors = new ArrayList<>();
		required(errors, "relationship", name, langService.get(lang, "Admin.relationship.nameRequired"));
		fail(errors, lang);
		Map<String, String> relationshipDef = requireRelationship(rule, name, lang);
		String desc = trim(raw.desc());
		String fromField = trim(raw.fromField());
		String toField = trim(raw.toField());
		required(errors, "desc", desc, langService.get(lang, "Admin.relationship.descRequired"));
		Map<String, Object> fromClass = findClass(classDefs(rule), relationshipDef.get("fromclass"));
		Map<String, Object> toClass = findClass(classDefs(rule), relationshipDef.get("toclass"));
		validateJoinFields(user, errors, lang, fromClass, toClass, fromField, toField);
		fail(errors, lang);
		return new CheckedRelationshipUpdate(name, relationshipDef,
				new RelationshipUpdate(desc, fromField, toField));
	}

	/*
	 * The three forms. Each describes one target: its fields with the owner's labels and options, its current values,
	 * and the save that writes it. A complete foreign draft is checked by the same rule as the save it addresses and
	 * returned normalized; a mid-edit refresh re-describes the form around the caller's values without refusing them.
	 */

	private static boolean editTarget(FormRequest body) {
		if (body.target() == null || body.changedField() != null && body.values() == null
				|| !("object".equals(body.target().kind()) || "draft".equals(body.target().kind()))) {
			throw badRequest();
		}
		return "object".equals(body.target().kind());
	}

	private static boolean draftToCheck(FormRequest body) {
		return body.values() != null && body.changedField() == null;
	}

	private static String formString(Map<String, Object> values, String key) {
		Object value = values.get(key);
		if (!(value == null || value instanceof String)) {
			throw badRequest();
		}
		return (String) value;
	}

	private static Boolean formBoolean(Map<String, Object> values, String key) {
		Object value = values.get(key);
		if (!(value == null || value instanceof Boolean)) {
			throw badRequest();
		}
		return (Boolean) value;
	}

	private static OntologyModelException badRequest() {
		return new OntologyModelException(400, "INVALID_REQUEST", "Invalid request", Map.of());
	}

	/** The attribute a form target names, by the two-part key the read client uses as one JSON array string. */
	private static String[] attributeKey(String primaryKey) {
		JsonNode node;
		try {
			node = ScheduleJson.JSON.readTree(primaryKey);
		} catch (Exception error) {
			throw badRequest();
		}
		if (!node.isArray() || node.size() != 2 || !node.get(0).isTextual() || !node.get(1).isTextual()) {
			throw badRequest();
		}
		return new String[] {node.get(0).asText(), node.get(1).asText()};
	}

	/** The caller's values over the target's own, trimmed as the save trims them; a form replaces its draft, never merges. */
	private static Map<String, Object> formValues(FormRequest body, Map<String, Object> current) {
		if (body.values() == null) {
			return current;
		}
		Map<String, Object> values = new LinkedHashMap<>();
		for (String key : current.keySet()) {
			Object given = body.values().get(key);
			values.put(key, given == null ? current.get(key) : given instanceof String text ? text.trim() : given);
		}
		return values;
	}

	private static Map<String, Object> objectTypeValues(String className, String primaryKeyName, String showName,
			String classDesc) {
		Map<String, Object> values = new LinkedHashMap<>();
		values.put("className", className);
		if (primaryKeyName != null) {
			values.put("primaryKeyName", primaryKeyName);
		}
		values.put("showName", showName);
		values.put("classDesc", classDesc);
		return values;
	}

	private static Map<String, Object> attributeValues(String className, String name, String type, String showName,
			String attrDesc, boolean enable, boolean businessKey, boolean primaryKey) {
		Map<String, Object> values = new LinkedHashMap<>();
		values.put("className", className);
		values.put("name", name);
		values.put("type", type);
		values.put("showName", showName);
		values.put("attrDesc", attrDesc);
		values.put("enable", enable);
		values.put("businessKey", businessKey);
		values.put("primaryKey", primaryKey);
		return values;
	}

	private static Map<String, Object> relationshipValues(String relationship, String fromclass, String fromField,
			String toclass, String toField, String desc) {
		Map<String, Object> values = new LinkedHashMap<>();
		values.put("relationship", relationship);
		values.put("fromclass", fromclass);
		values.put("fromField", fromField);
		values.put("toclass", toclass);
		values.put("toField", toField);
		values.put("desc", desc);
		return values;
	}

	/** A join field holds one of its class's attributes; the value held for the class before is no longer one of them. */
	private static String joinField(Map<String, Object> rule, String className, String field) {
		if (blank(field)) {
			return "";
		}
		Map<String, Object> classDef = blank(className) ? null : findClass(classDefs(rule), className);
		return classDef != null && hasAttribute(classDef, field) ? field : "";
	}

	private Map<String, Object> draftObjectTypeCreate(Map<String, Object> rule, Map<String, Object> values, User user,
			String lang) {
		ObjectTypeCreate body = checkedObjectTypeCreate(rule, user, new ObjectTypeCreate(formString(values, "className"),
				formString(values, "primaryKeyName"), formString(values, "showName"), formString(values, "classDesc")),
				lang).body();
		return objectTypeValues(body.className(), body.primaryKeyName(), body.showName(), body.classDesc());
	}

	private Map<String, Object> draftObjectTypeUpdate(Map<String, Object> rule, String className,
			Map<String, Object> values, User user, String lang) {
		CheckedObjectTypeUpdate checked = checkedObjectTypeUpdate(rule, className, new ObjectTypeUpdate(
				formString(values, "showName"), formString(values, "classDesc")), user, lang);
		return objectTypeValues(checked.className(), null, checked.body().showName(), checked.body().classDesc());
	}

	private Map<String, Object> draftAttributeCreate(Map<String, Object> rule, Map<String, Object> values, User user,
			String lang) {
		CheckedAttributeCreate checked = checkedAttributeCreate(rule, formString(values, "className"),
				new AttributeCreate(formString(values, "name"), formString(values, "showName"),
						formString(values, "type"), formString(values, "attrDesc"), formBoolean(values, "enable"),
						formBoolean(values, "businessKey"), formBoolean(values, "primaryKey")),
				user, lang);
		return attributeValues(checked.className(), checked.body().name(), checked.body().type(),
				checked.body().showName(), checked.body().attrDesc(), checked.body().enable(),
				checked.body().businessKey(), Boolean.TRUE.equals(checked.body().primaryKey()));
	}

	private Map<String, Object> draftAttributeUpdate(Map<String, Object> rule, String[] key, Map<String, Object> values,
			User user, String lang) {
		CheckedAttributeUpdate checked = checkedAttributeUpdate(rule, key[0], key[1], new AttributeUpdate(
				formString(values, "showName"), formString(values, "attrDesc"), formBoolean(values, "enable"),
				formBoolean(values, "businessKey")), user, lang);
		return attributeValues(checked.className(), checked.name(), text(checked.attrDef().get("type")),
				checked.body().showName(), checked.body().attrDesc(), checked.body().enable(),
				checked.body().businessKey(), primaryKey(checked.attrDef()));
	}

	private Map<String, Object> draftRelationshipCreate(Map<String, Object> rule, Map<String, Object> values, User user,
			String lang) {
		RelationshipCreate body = checkedRelationshipCreate(rule, user, new RelationshipCreate(
				formString(values, "relationship"), formString(values, "fromclass"), formString(values, "toclass"),
				formString(values, "desc"), formString(values, "fromField"), formString(values, "toField")), lang)
				.body();
		return relationshipValues(body.relationship(), body.fromclass(), body.fromField(), body.toclass(),
				body.toField(), body.desc());
	}

	private Map<String, Object> draftRelationshipUpdate(Map<String, Object> rule, String relationship,
			Map<String, Object> values, User user, String lang) {
		CheckedRelationshipUpdate checked = checkedRelationshipUpdate(rule, relationship, new RelationshipUpdate(
				formString(values, "desc"), formString(values, "fromField"), formString(values, "toField")), user, lang);
		return relationshipValues(checked.relationship(), text(checked.relationshipDef().get("fromclass")),
				checked.body().fromField(), text(checked.relationshipDef().get("toclass")), checked.body().toField(),
				checked.body().desc());
	}

	private static ObjectNode selectControl(List<JsonNode> options, String placeholder) {
		ObjectNode control = object("kind", "select", "options", options);
		if (placeholder != null && !placeholder.isBlank()) {
			control.put("placeholder", placeholder);
		}
		return control;
	}

	private static ObjectNode textControl(boolean multiline) {
		return textControl(multiline, null);
	}

	private static ObjectNode textControl(boolean multiline, Integer maxLength) {
		ObjectNode control = multiline ? object("kind", "text", "multiline", true) : object("kind", "text");
		if (maxLength != null) {
			control.put("maxLength", maxLength);
		}
		return control;
	}

	private static ObjectNode switchControl() {
		return object("kind", "switch");
	}

	private static ObjectNode stringSchema(String label) {
		return stringSchema(label, null);
	}

	private static ObjectNode stringSchema(String label, Integer maxLength) {
		ObjectNode schema = object("type", "string", "title", label);
		if (maxLength != null) {
			schema.put("maxLength", maxLength);
		}
		return schema;
	}

	private static ObjectNode booleanSchema(String label) {
		return object("type", "boolean", "title", label);
	}

	private static ObjectNode enumSchema(String label, List<String> values) {
		return object("type", "string", "enum", values, "title", label);
	}

	private static ObjectNode objectSchema(List<String> required, Object... propertyPairs) {
		return object("type", "object", "properties", object(propertyPairs), "required", required,
				"additionalProperties", false);
	}

	/** One field of a panel form, as the contract describes it; the reason appears only on a locked field. */
	private static ObjectNode panelField(String path, String label, boolean required, ObjectNode control,
			ObjectNode valueSchema, boolean readOnly, String readOnlyReason, boolean refreshOnChange) {
		ObjectNode field = object("path", path, "label", label, "control", control, "valueSchema", valueSchema,
				"required", required, "readOnly", readOnly);
		if (readOnlyReason != null) {
			field.put("readOnlyReason", readOnlyReason);
		}
		if (refreshOnChange) {
			field.put("refreshOnChange", true);
		}
		return field;
	}

	private static String optionLabel(String showName, String name) {
		return blank(showName) ? name : showName + " (" + name + ")";
	}

	private List<JsonNode> objectTypeOptions(Map<String, Object> rule) {
		return classDefs(rule).stream()
				.map(classDef -> FormFields.option(text(classDef.get("className")),
						optionLabel(text(classDef.get("showName")), text(classDef.get("className"))), null, null))
				.toList();
	}

	private static List<JsonNode> attributeTypeOptions() {
		return ATTRIBUTE_TYPES.stream().map(type -> FormFields.option(type, type, null, null)).toList();
	}

	/** The attributes of one class, as a join field's options; a class nothing selected offers none. */
	private static List<JsonNode> attributeOptions(Map<String, Object> rule, String className) {
		if (blank(className)) {
			return List.of();
		}
		Map<String, Object> classDef = findClass(classDefs(rule), className);
		if (classDef == null) {
			return List.of();
		}
		return attrs(classDef).stream()
				.map(attr -> FormFields.option(text(attr.get("name")),
						optionLabel(text(attr.get("showName")), text(attr.get("name"))), null, null))
				.toList();
	}

	/*
	 * The owner's label of each field of the three model objects, by field key. The forms, their save schemas and the
	 * field-label read all take a field's label from here.
	 */
	private static final Map<String, String> OBJECT_TYPE_LABEL_KEYS = Map.of(
			"className", "Admin.form.className",
			"primaryKeyName", "Admin.form.primaryKeyName",
			"showName", "Admin.form.showName",
			"classDesc", "Admin.form.desc");
	private static final Map<String, String> ATTRIBUTE_LABEL_KEYS = Map.of(
			"className", "Admin.form.ownerType",
			"name", "Admin.form.name",
			"type", "Admin.form.type",
			"showName", "Admin.form.showName",
			"attrDesc", "Admin.form.desc",
			"enable", "Admin.form.enable",
			"businessKey", "Admin.form.businessKey",
			"primaryKey", "Admin.form.primaryKey");
	private static final Map<String, String> RELATIONSHIP_LABEL_KEYS = Map.of(
			"relationship", "Admin.form.relationship",
			"fromclass", "Admin.form.fromclass",
			"fromField", "Admin.form.fromField",
			"toclass", "Admin.form.toclass",
			"toField", "Admin.form.toField",
			"desc", "Admin.form.relationDesc");

	private Map<String, String> labels(Map<String, String> keys, String lang) {
		Map<String, String> labels = new LinkedHashMap<>();
		keys.forEach((field, key) -> labels.put(field, langService.get(lang, key)));
		return labels;
	}

	private List<ObjectNode> objectTypeFields(boolean edit, String lang) {
		Map<String, String> label = labels(OBJECT_TYPE_LABEL_KEYS, lang);
		String classNameLabel = label.get("className");
		String primaryKeyNameLabel = label.get("primaryKeyName");
		String showNameLabel = label.get("showName");
		String descLabel = label.get("classDesc");
		List<ObjectNode> fields = new ArrayList<>();
		ObjectNode classNameField = panelField("/className", classNameLabel, true, textControl(false),
				stringSchema(classNameLabel), edit, null, false);
		ObjectNode showNameField = panelField("/showName", showNameLabel, true, textControl(false, 80),
				stringSchema(showNameLabel, 80), false, null, false);
		ObjectNode descField = panelField("/classDesc", descLabel, false, textControl(true, 400),
				stringSchema(descLabel, 400), false, null, false);
		if (edit) {
			// Match the detail view's edit order: editable display name first, read-only API name second, description last.
			fields.add(showNameField);
			fields.add(classNameField);
			fields.add(descField);
		} else {
			fields.add(classNameField);
			fields.add(panelField("/primaryKeyName", primaryKeyNameLabel, true, textControl(false),
					stringSchema(primaryKeyNameLabel), false, null, false));
			fields.add(showNameField);
			fields.add(descField);
		}
		return fields;
	}

	private List<ObjectNode> attributeFields(Map<String, Object> rule, boolean edit, Map<String, Object> attrDef,
			String lang) {
		Map<String, String> label = labels(ATTRIBUTE_LABEL_KEYS, lang);
		String ownerLabel = label.get("className");
		String nameLabel = label.get("name");
		String typeLabel = label.get("type");
		String showNameLabel = label.get("showName");
		String descLabel = label.get("attrDesc");
		String enableLabel = label.get("enable");
		String businessKeyLabel = label.get("businessKey");
		String primaryKeyLabel = label.get("primaryKey");
		boolean locked = attrDef != null && primaryKey(attrDef);
		List<ObjectNode> fields = new ArrayList<>();
		fields.add(panelField("/className", ownerLabel, true, object("kind", "select", "options", objectTypeOptions(rule)),
				stringSchema(ownerLabel), edit, null, false));
		fields.add(panelField("/name", nameLabel, true, textControl(false), stringSchema(nameLabel), edit, null, false));
		fields.add(panelField("/type", typeLabel, true, object("kind", "select", "options", attributeTypeOptions()),
				enumSchema(typeLabel, ATTRIBUTE_TYPES), edit, null, false));
		fields.add(panelField("/showName", showNameLabel, true, textControl(false), stringSchema(showNameLabel),
				false, null, false));
		fields.add(panelField("/attrDesc", descLabel, false, textControl(true), stringSchema(descLabel),
				false, null, false));
		fields.add(panelField("/enable", enableLabel, true, switchControl(), booleanSchema(enableLabel), locked,
				locked ? langService.get(lang, "Admin.form.primaryKeyEnableLocked") : null, false));
		fields.add(panelField("/businessKey", businessKeyLabel, true, switchControl(), booleanSchema(businessKeyLabel),
				false, null, false));
		fields.add(panelField("/primaryKey", primaryKeyLabel, false, switchControl(), booleanSchema(primaryKeyLabel),
				edit, edit ? langService.get(lang, "Admin.form.primaryKeySwitchHint") : null, false));
		return fields;
	}

	private List<ObjectNode> relationshipFields(Map<String, Object> rule, boolean edit, Map<String, Object> values,
			User user, String lang) {
		Map<String, String> label = labels(RELATIONSHIP_LABEL_KEYS, lang);
		String nameLabel = edit ? langService.get(lang, "Admin.form.apiName") : label.get("relationship");
		String fromClassLabel = label.get("fromclass");
		String fromFieldLabel = label.get("fromField");
		String toClassLabel = label.get("toclass");
		String toFieldLabel = label.get("toField");
		String descLabel = label.get("desc");
		String selectFromClass = langService.get(lang, "Admin.form.selectFromclass");
		String enterFromField = langService.get(lang, "Admin.form.enterFromField");
		String selectToClass = langService.get(lang, "Admin.form.selectToclass");
		String enterToField = langService.get(lang, "Admin.form.enterToField");
		boolean joinRequired = joinFieldsRequired(user);
		String fromClass = formString(values, "fromclass");
		String toClass = formString(values, "toclass");
		List<ObjectNode> fields = new ArrayList<>();
		if (edit) {
			// Match the detail view's edit fields: read-only API name, description, and the two join fields (ends are shown beside the form).
			fields.add(panelField("/relationship", nameLabel, false, textControl(false), stringSchema(nameLabel),
					true, null, false));
			fields.add(panelField("/desc", descLabel, false, textControl(true, 400), stringSchema(descLabel, 400),
					false, null, false));
			fields.add(panelField("/fromField", fromFieldLabel, joinRequired,
					selectControl(attributeOptions(rule, fromClass), enterFromField),
					stringSchema(fromFieldLabel), false, null, false));
			fields.add(panelField("/toField", toFieldLabel, joinRequired,
					selectControl(attributeOptions(rule, toClass), enterToField),
					stringSchema(toFieldLabel), false, null, false));
			return fields;
		}
		List<JsonNode> classOptions = objectTypeOptions(rule);
		fields.add(panelField("/relationship", nameLabel, true, textControl(false, 80), stringSchema(nameLabel, 80),
				false, null, false));
		fields.add(panelField("/fromclass", fromClassLabel, true, selectControl(classOptions, selectFromClass),
				stringSchema(fromClassLabel), false, null, true));
		fields.add(panelField("/fromField", fromFieldLabel, joinRequired,
				selectControl(attributeOptions(rule, fromClass), enterFromField),
				stringSchema(fromFieldLabel), fromClass.isEmpty(), null, false));
		fields.add(panelField("/toclass", toClassLabel, true, selectControl(classOptions, selectToClass),
				stringSchema(toClassLabel), false, null, true));
		fields.add(panelField("/toField", toFieldLabel, joinRequired,
				selectControl(attributeOptions(rule, toClass), enterToField),
				stringSchema(toFieldLabel), toClass.isEmpty(), null, false));
		fields.add(panelField("/desc", descLabel, true, textControl(true, 400), stringSchema(descLabel, 400),
				false, null, false));
		return fields;
	}

	private FormSave objectTypeFormSave(boolean edit, String lang) {
		Map<String, String> label = labels(OBJECT_TYPE_LABEL_KEYS, lang);
		if (edit) {
			return new FormSave("POST", "/ontology/model/object-type/update",
					objectSchema(List.of("className", "showName"), "className",
							stringSchema(label.get("className")), "showName",
							stringSchema(label.get("showName")), "classDesc",
							stringSchema(label.get("classDesc"))),
					"objectType.update");
		}
		return new FormSave("POST", "/ontology/model/object-type/create",
				objectSchema(List.of("className", "primaryKeyName", "showName"), "className",
						stringSchema(label.get("className")), "primaryKeyName",
						stringSchema(label.get("primaryKeyName")), "showName",
						stringSchema(label.get("showName")), "classDesc",
						stringSchema(label.get("classDesc"))),
				"objectType.create");
	}

	private FormSave attributeFormSave(boolean edit, String lang) {
		Map<String, String> label = labels(ATTRIBUTE_LABEL_KEYS, lang);
		if (edit) {
			return new FormSave("POST", "/ontology/model/attribute/update",
					objectSchema(List.of("className", "name", "showName", "enable", "businessKey"), "className",
							stringSchema(label.get("className")), "name",
							stringSchema(label.get("name")), "showName",
							stringSchema(label.get("showName")), "attrDesc",
							stringSchema(label.get("attrDesc")), "enable",
							booleanSchema(label.get("enable")), "businessKey",
							booleanSchema(label.get("businessKey"))),
					"attribute.update");
		}
		return new FormSave("POST", "/ontology/model/attribute/create",
				objectSchema(List.of("className", "name", "showName", "type", "enable", "businessKey"), "className",
						stringSchema(label.get("className")), "name",
						stringSchema(label.get("name")), "showName",
						stringSchema(label.get("showName")), "type",
						enumSchema(label.get("type"), ATTRIBUTE_TYPES), "attrDesc",
						stringSchema(label.get("attrDesc")), "enable",
						booleanSchema(label.get("enable")), "businessKey",
						booleanSchema(label.get("businessKey")), "primaryKey",
						booleanSchema(label.get("primaryKey"))),
				"attribute.create");
	}

	private FormSave relationshipFormSave(boolean edit, boolean joinRequired, String lang) {
		Map<String, String> label = labels(RELATIONSHIP_LABEL_KEYS, lang);
		List<String> required = new ArrayList<>(edit
				? List.of("relationship", "desc")
				: List.of("relationship", "fromclass", "toclass", "desc"));
		if (joinRequired) {
			required.addAll(List.of("fromField", "toField"));
		}
		ObjectNode properties;
		if (edit) {
			properties = object(
					"relationship", stringSchema(label.get("relationship")),
					"desc", stringSchema(label.get("desc")),
					"fromField", stringSchema(label.get("fromField")),
					"toField", stringSchema(label.get("toField")));
		} else {
			properties = object(
					"relationship", stringSchema(label.get("relationship")),
					"fromclass", stringSchema(label.get("fromclass")),
					"toclass", stringSchema(label.get("toclass")),
					"desc", stringSchema(label.get("desc")),
					"fromField", stringSchema(label.get("fromField")),
					"toField", stringSchema(label.get("toField")));
		}
		return new FormSave("POST",
				edit ? "/ontology/model/relationship/update" : "/ontology/model/relationship/create",
				object("type", "object", "properties", properties, "required", required, "additionalProperties", false),
				edit ? "relationship.update" : "relationship.create");
	}

	private ObjectTypeView objectTypeView(Map<String, Object> classDef,
			Map<String, Map<String, String>> relationships) {
		List<Map<String, Object>> attrs = attrs(classDef);
		String className = (String) classDef.get("className");
		int businessKeys = (int) attrs.stream().filter(OntologyModelServiceImpl::businessKey).count();
		int relationshipsCount = (int) relationships.values().stream()
				.filter(def -> className.equals(def.get("fromclass")) || className.equals(def.get("toclass")))
				.count();
		return new ObjectTypeView(className, text(classDef.get("showName")), text(classDef.get("classDesc")),
				attrs.size(), businessKeys, relationshipsCount, primaryKeyView(classDef), searchableAttributes(attrs));
	}

	private List<String> searchableAttributes(List<Map<String, Object>> attrs) {
		java.util.LinkedHashSet<String> terms = new java.util.LinkedHashSet<>();
		for (Map<String, Object> attr : attrs) {
			String showName = trim(text(attr.get("showName")));
			String name = trim(text(attr.get("name")));
			if (!showName.isEmpty()) {
				terms.add(showName);
			}
			if (!name.isEmpty()) {
				terms.add(name);
			}
		}
		return List.copyOf(terms);
	}

	private Map<String, String> classShowNames(Map<String, Object> rule) {
		Map<String, String> names = new LinkedHashMap<>();
		for (Map<String, Object> classDef : classDefs(rule)) {
			String className = text(classDef.get("className"));
			if (className.isEmpty()) {
				continue;
			}
			String showName = trim(text(classDef.get("showName")));
			names.put(className, showName.isEmpty() ? className : showName);
		}
		return names;
	}

	private Map<String, Object> primaryKeyView(Map<String, Object> classDef) {
		List<Map<String, Object>> keys = attrs(classDef).stream().filter(OntologyModelServiceImpl::primaryKey).toList();
		Map<String, Object> view = new LinkedHashMap<>();
		if (keys.isEmpty()) {
			view.put("status", "missing");
		} else if (keys.size() > 1) {
			view.put("status", "multiple");
		} else {
			Map<String, Object> key = keys.get(0);
			view.put("status", enabled(key.get("enable")) ? "ok" : "disabled");
			view.put("name", key.get("name"));
		}
		return view;
	}

	private AttributeView attributeView(String className, Map<String, Object> attr) {
		return new AttributeView(className, text(attr.get("name")), text(attr.get("showName")),
				text(attr.get("type")), text(attr.get("attrDesc")), enabled(attr.get("enable")),
				businessKey(attr), primaryKey(attr));
	}

	private RelationshipView relationshipView(String relationship, Map<String, String> def,
			Map<String, String> classShowNames) {
		String fromclass = text(def.get("fromclass"));
		String toclass = text(def.get("toclass"));
		String fromShowName = classShowNames.getOrDefault(fromclass, fromclass);
		String toShowName = classShowNames.getOrDefault(toclass, toclass);
		return new RelationshipView(relationship, fromclass, toclass,
				text(def.get("desc")), text(def.get("fromField")), text(def.get("toField")),
				fromShowName, toShowName);
	}

	private List<RelationshipView> cascadingRelationships(Map<String, Object> rule, String className) {
		Map<String, String> classShowNames = classShowNames(rule);
		List<RelationshipView> result = new ArrayList<>();
		for (Map.Entry<String, Map<String, String>> entry : relationships(rule).entrySet()) {
			Map<String, String> def = entry.getValue();
			if (className.equals(def.get("fromclass")) || className.equals(def.get("toclass"))) {
				result.add(relationshipView(entry.getKey(), def, classShowNames));
			}
		}
		return result;
	}

	private List<String> usingRelationships(Map<String, Object> rule, String className, String attrName) {
		List<String> names = new ArrayList<>();
		for (Map.Entry<String, Map<String, String>> entry : relationships(rule).entrySet()) {
			Map<String, String> def = entry.getValue();
			boolean from = className.equals(def.get("fromclass")) && attrName.equals(def.get("fromField"));
			boolean to = className.equals(def.get("toclass")) && attrName.equals(def.get("toField"));
			if (from || to) {
				names.add(entry.getKey());
			}
		}
		return names;
	}

	private void validateClassName(DataAdapter adapter, String className, List<ObjectNode> errors, String lang) {
		// A class name is a domain-level name, not only what one data source happens to accept: the same rule the page shows.
		if (!className.matches(NAME_PATTERN)) {
			errors.add(field("className", "invalid_format", langService.get(lang, "Admin.class.formatError")));
			return;
		}
		try {
			adapter.validateClassNameFormat(className);
		} catch (Exception error) {
			errors.add(field("className", "invalid_format", error.getMessage()));
		}
	}

	private void validateName(String name, List<ObjectNode> errors, String field, String lang, String messageKey) {
		if (!name.matches(NAME_PATTERN)) {
			errors.add(field(field, "invalid_format", langService.get(lang, messageKey)));
		}
	}

	private boolean joinFieldsRequired(User user) {
		return dataAdapterRegistry.provider(businessConfig(user).getDataAdapter()).requiresJoinFields();
	}

	private void validateJoinFields(User user, List<ObjectNode> errors, String lang, Map<String, Object> fromClass,
			Map<String, Object> toClass, String fromField, String toField) {
		boolean required = joinFieldsRequired(user);
		if (required && blank(fromField)) {
			errors.add(field("fromField", "required", langService.get(lang, "Admin.relationship.fromFieldRequired")));
		}
		if (required && blank(toField)) {
			errors.add(field("toField", "required", langService.get(lang, "Admin.relationship.toFieldRequired")));
		}
		if (!blank(fromField) && fromClass != null && !hasAttribute(fromClass, fromField)) {
			errors.add(field("fromField", "invalid_option", langService.get(lang, "Admin.relationship.fromFieldInvalid")));
		}
		if (!blank(toField) && toClass != null && !hasAttribute(toClass, toField)) {
			errors.add(field("toField", "invalid_option", langService.get(lang, "Admin.relationship.toFieldInvalid")));
		}
	}

	private static boolean hasAttribute(Map<String, Object> classDef, String name) {
		return attrs(classDef).stream().anyMatch(attr -> name.equals(attr.get("name")));
	}

	private static boolean businessKey(Map<String, Object> attr) {
		return booleanValue(attr.get("bizzkeyBool")) || booleanValue(attr.get("bizzkey"));
	}

	private static boolean primaryKey(Map<String, Object> attr) {
		return booleanValue(attr.get("primaryKey")) || booleanValue(attr.get("primary_key"));
	}

	private static boolean booleanValue(Object value) {
		if (value instanceof Boolean flag) {
			return flag;
		}
		return value != null && "true".equalsIgnoreCase(value.toString().trim());
	}

	private static boolean enabled(Object value) {
		if (value == null) {
			return true;
		}
		if (value instanceof Boolean flag) {
			return flag;
		}
		return !"false".equalsIgnoreCase(value.toString().trim());
	}

	private static String text(Object value) {
		return value == null ? "" : value.toString();
	}

	private static String trim(String value) {
		return value == null ? "" : value.trim();
	}

	private static boolean blank(String value) {
		return value == null || value.isBlank();
	}

	private void required(List<ObjectNode> errors, String field, String value, String message) {
		if (blank(value)) {
			errors.add(field(field, "required", message));
		}
	}

	private void required(List<ObjectNode> errors, String field, Boolean value, String message) {
		if (value == null) {
			errors.add(field(field, "required", message));
		}
	}

	private static ObjectNode field(String name, String code, String message) {
		return FormFields.error("/values/" + name, code, message);
	}

	private static String fieldName(ObjectNode error) {
		return error.path("field").asText().substring("/values/".length());
	}

	private void fail(List<ObjectNode> errors, String lang) {
		if (!errors.isEmpty()) {
			String reasons = String.join("; ", errors.stream().map(error -> error.path("message").asText()).toList());
			throw OntologyModelException.validation(errors, langService.get(lang, "Admin.validation.failed") + ": " + reasons);
		}
	}

	private void audit(User user, String operation, String description, String parameter) {
		AuditLog auditLog = new AuditLog();
		auditLog.setId(UUID.randomUUID().toString());
		auditLog.setBussiness(AuditLog.BUSSINESS_SCHEMA);
		auditLog.setByAi(false);
		auditLog.setUserId(user.getId());
		auditLog.setUserName(user.getUserName());
		auditLog.setOperation(operation);
		auditLog.setDescription(description);
		auditLog.setParamter(parameter);
		auditLog.setOperateTime(System.currentTimeMillis());
		auditLogDao.save(auditLog, user.getDomainId());
	}

	private String description(User user, String key, String target) {
		return langService.get(sysLang(user), key) + ": " + target;
	}
}
