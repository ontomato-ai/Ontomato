package io.ontomato.dataengine.service.impl;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.node.ObjectNode;

import cn.hutool.core.lang.UUID;

import io.ontomato.dataengine.bean.AuditLog;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.AuditLogDao;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.FormFields;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.OntologyModelException;
import io.ontomato.dataengine.service.OntologyModelService;

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
		Map<String, Map<String, String>> relationships = relationships(rule(user));
		List<RelationshipView> result = new ArrayList<>();
		for (Map.Entry<String, Map<String, String>> entry : relationships.entrySet()) {
			Map<String, String> def = entry.getValue();
			if (blank(className) || className.equals(def.get("fromclass")) || className.equals(def.get("toclass"))) {
				result.add(relationshipView(entry.getKey(), def));
			}
		}
		return result;
	}

	@Override
	public RelationshipView relationship(String relationship, User user, String lang) {
		Map<String, String> def = relationships(rule(user)).get(relationship);
		if (def == null) {
			throw relationshipNotFound(lang);
		}
		return relationshipView(relationship, def);
	}

	@Override
	public DeletionImpact deletionImpact(String className, User user, String lang) {
		Map<String, Object> rule = rule(user);
		requireClass(rule, className, lang);
		return new DeletionImpact(cascadingRelationships(rule, className));
	}

	@Override
	public ObjectTypeView createObjectType(ObjectTypeCreate body, User user, String lang) {
		Map<String, Object> rule = rule(user);
		List<ObjectNode> errors = new ArrayList<>();
		String className = trim(body.className());
		String primaryKeyName = trim(body.primaryKeyName());
		String showName = trim(body.showName());
		String classDesc = trim(body.classDesc());

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

		Map<String, Object> primaryKey = new HashMap<>();
		primaryKey.put("name", primaryKeyName);
		primaryKey.put("showName", primaryKeyName);
		primaryKey.put("attrDesc", "");
		primaryKey.put("type", "varchar");
		primaryKey.put("bizzkey", false);
		primaryKey.put("enable", true);
		primaryKey.put("primaryKey", true);
		List<Map<String, Object>> attrs = new ArrayList<>();
		attrs.add(primaryKey);

		Map<String, Object> classDef = new HashMap<>();
		classDef.put("className", className);
		classDef.put("showName", showName);
		classDef.put("classDesc", classDesc);
		classDef.put("classToCard", false);
		classDef.put("instanceToCard", false);
		classDef.put("inStarChart", false);
		classDef.put("attrs", attrs);
		classDefs(rule).add(classDef);
		classList(rule).add(className);
		write(user, rule);
		audit(user, AuditLog.OPERATION_ADD, description(user, "AuditLog.class.add", className),
				com.alibaba.fastjson2.JSONObject.toJSONString(classDef));
		return objectTypeView(classDef, relationships(rule));
	}

	@Override
	public ObjectTypeView updateObjectType(String className, ObjectTypeUpdate body, User user, String lang) {
		Map<String, Object> rule = rule(user);
		String owner = trim(className);
		List<ObjectNode> errors = new ArrayList<>();
		String showName = trim(body.showName());
		String classDesc = trim(body.classDesc());
		required(errors, "className", owner, langService.get(lang, "Admin.class.nameRequired"));
		required(errors, "showName", showName, langService.get(lang, "Admin.class.nameRequired"));
		fail(errors, lang);
		Map<String, Object> classDef = requireClass(rule, owner, lang);

		classDef.put("showName", showName);
		classDef.put("classDesc", classDesc);
		write(user, rule);
		audit(user, AuditLog.OPERATION_UPD, description(user, "AuditLog.class.upd", owner),
				com.alibaba.fastjson2.JSONObject.toJSONString(classDef));
		return objectTypeView(classDef, relationships(rule));
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
	public AttributeView createAttribute(String className, AttributeCreate body, User user, String lang) {
		Map<String, Object> rule = rule(user);
		String owner = trim(className);
		List<ObjectNode> errors = new ArrayList<>();
		required(errors, "className", owner, langService.get(lang, "Admin.class.nameRequired"));
		Map<String, Object> classDef = blank(owner) ? null : findClass(classDefs(rule), owner);
		List<Map<String, Object>> attrs = classDef == null ? List.of() : attrs(classDef);
		String name = trim(body.name());
		String showName = trim(body.showName());
		String type = trim(body.type());
		String attrDesc = trim(body.attrDesc());

		required(errors, "name", name, langService.get(lang, "Admin.attr.nameRequired"));
		required(errors, "showName", showName, langService.get(lang, "Admin.attr.showNameRequired"));
		required(errors, "type", type, langService.get(lang, "Admin.attr.typeRequired"));
		required(errors, "enable", body.enable(), langService.get(lang, "Admin.field.booleanRequired"));
		required(errors, "businessKey", body.businessKey(), langService.get(lang, "Admin.field.booleanRequired"));
		if (!blank(name)) {
			validateName(name, errors, "name", lang, "Admin.attr.formatError");
			if (attrs.stream().anyMatch(attr -> name.equals(attr.get("name")))) {
				errors.add(field("name", "already_exists", langService.get(lang, "Admin.attr.exist")));
			}
		}
		if (!blank(type) && !ATTRIBUTE_TYPES.contains(type)) {
			errors.add(field("type", "invalid_option", langService.get(lang, "Admin.attr.typeError")));
		}
		boolean primaryKey = Boolean.TRUE.equals(body.primaryKey());
		if (primaryKey && ATTRIBUTE_TYPES.contains(type) && !"varchar".equals(type)) {
			errors.add(field("type", "invalid_option", langService.get(lang, "Admin.attr.primaryKeyInvalid")));
		}
		if (primaryKey && Boolean.FALSE.equals(body.enable())) {
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
		classDef = requireClass(rule, owner, lang);
		attrs = attrs(classDef);

		Map<String, Object> attrDef = new HashMap<>();
		attrDef.put("name", name);
		attrDef.put("showName", showName);
		attrDef.put("attrDesc", attrDesc);
		attrDef.put("type", type);
		attrDef.put("bizzkey", Boolean.TRUE.equals(body.businessKey()));
		attrDef.put("enable", body.enable());
		attrDef.put("primaryKey", primaryKey);
		if (primaryKey) {
			for (Map<String, Object> attr : attrs) {
				attr.put("primaryKey", false);
			}
		}
		attrs.add(attrDef);
		write(user, rule);
		audit(user, AuditLog.OPERATION_UPD,
				description(user, "AuditLog.class", owner) + ", "
						+ langService.get(sysLang(user), "AuditLog.attr.add") + ": " + name,
				com.alibaba.fastjson2.JSONObject.toJSONString(attrDef));
		return attributeView(owner, attrDef);
	}

	@Override
	public AttributeView updateAttribute(String className, String name, AttributeUpdate body, User user, String lang) {
		Map<String, Object> rule = rule(user);
		String owner = trim(className);
		String attrName = trim(name);
		List<ObjectNode> errors = new ArrayList<>();
		String showName = trim(body.showName());
		String attrDesc = trim(body.attrDesc());
		required(errors, "className", owner, langService.get(lang, "Admin.class.nameRequired"));
		required(errors, "name", attrName, langService.get(lang, "Admin.attr.nameRequired"));
		required(errors, "showName", showName, langService.get(lang, "Admin.attr.showNameRequired"));
		required(errors, "enable", body.enable(), langService.get(lang, "Admin.field.booleanRequired"));
		required(errors, "businessKey", body.businessKey(), langService.get(lang, "Admin.field.booleanRequired"));
		fail(errors, lang);
		Map<String, Object> classDef = requireClass(rule, owner, lang);
		Map<String, Object> attrDef = requireAttribute(classDef, attrName, lang);
		if (Boolean.FALSE.equals(body.enable()) && booleanValue(attrDef.get("primaryKey"))) {
			throw OntologyModelException.conflict("PRIMARY_KEY_LOCKED",
					langService.get(lang, "Admin.attr.primaryKeyLocked"), Map.of());
		}

		attrDef.put("showName", showName);
		attrDef.put("attrDesc", attrDesc);
		attrDef.put("enable", body.enable());
		attrDef.put("bizzkey", Boolean.TRUE.equals(body.businessKey()));
		write(user, rule);
		audit(user, AuditLog.OPERATION_UPD,
				description(user, "AuditLog.class", owner) + ", "
						+ langService.get(sysLang(user), "AuditLog.attr.upd") + ": " + attrName,
				com.alibaba.fastjson2.JSONObject.toJSONString(attrDef));
		return attributeView(owner, attrDef);
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
	public RelationshipView createRelationship(RelationshipCreate body, User user, String lang) {
		Map<String, Object> rule = rule(user);
		List<ObjectNode> errors = new ArrayList<>();
		String relationship = trim(body.relationship());
		String fromclass = trim(body.fromclass());
		String toclass = trim(body.toclass());
		String desc = trim(body.desc());
		String fromField = trim(body.fromField());
		String toField = trim(body.toField());

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

		Map<String, String> relationshipDef = new HashMap<>();
		relationshipDef.put("fromclass", fromclass);
		relationshipDef.put("toclass", toclass);
		relationshipDef.put("desc", desc);
		relationshipDef.put("fromField", fromField);
		relationshipDef.put("toField", toField);
		relationshipDef.put("fromdesc", "");
		relationshipDef.put("todesc", "");
		relationships(rule).put(relationship, relationshipDef);
		write(user, rule);
		audit(user, AuditLog.OPERATION_ADD, description(user, "AuditLog.relationship.add", relationship),
				com.alibaba.fastjson2.JSONObject.toJSONString(relationshipDef));
		return relationshipView(relationship, relationshipDef);
	}

	@Override
	public RelationshipView updateRelationship(String relationship, RelationshipUpdate body, User user, String lang) {
		Map<String, Object> rule = rule(user);
		String name = trim(relationship);
		List<ObjectNode> errors = new ArrayList<>();
		required(errors, "relationship", name, langService.get(lang, "Admin.relationship.nameRequired"));
		fail(errors, lang);
		Map<String, String> relationshipDef = relationships(rule).get(name);
		if (relationshipDef == null) {
			throw relationshipNotFound(lang);
		}
		String desc = trim(body.desc());
		String fromField = trim(body.fromField());
		String toField = trim(body.toField());
		required(errors, "desc", desc, langService.get(lang, "Admin.relationship.descRequired"));
		Map<String, Object> fromClass = findClass(classDefs(rule), relationshipDef.get("fromclass"));
		Map<String, Object> toClass = findClass(classDefs(rule), relationshipDef.get("toclass"));
		validateJoinFields(user, errors, lang, fromClass, toClass, fromField, toField);
		fail(errors, lang);

		relationshipDef.put("desc", desc);
		relationshipDef.put("fromField", fromField);
		relationshipDef.put("toField", toField);
		write(user, rule);
		audit(user, AuditLog.OPERATION_UPD, description(user, "AuditLog.relationship.upd", name),
				com.alibaba.fastjson2.JSONObject.toJSONString(relationshipDef));
		return relationshipView(name, relationshipDef);
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

	private ObjectTypeView objectTypeView(Map<String, Object> classDef,
			Map<String, Map<String, String>> relationships) {
		List<Map<String, Object>> attrs = attrs(classDef);
		String className = (String) classDef.get("className");
		int businessKeys = (int) attrs.stream().filter(OntologyModelServiceImpl::businessKey).count();
		int relationshipsCount = (int) relationships.values().stream()
				.filter(def -> className.equals(def.get("fromclass")) || className.equals(def.get("toclass")))
				.count();
		return new ObjectTypeView(className, text(classDef.get("showName")), text(classDef.get("classDesc")),
				attrs.size(), businessKeys, relationshipsCount, primaryKeyView(classDef));
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

	private RelationshipView relationshipView(String relationship, Map<String, String> def) {
		return new RelationshipView(relationship, text(def.get("fromclass")), text(def.get("toclass")),
				text(def.get("desc")), text(def.get("fromField")), text(def.get("toField")));
	}

	private List<RelationshipView> cascadingRelationships(Map<String, Object> rule, String className) {
		List<RelationshipView> result = new ArrayList<>();
		for (Map.Entry<String, Map<String, String>> entry : relationships(rule).entrySet()) {
			Map<String, String> def = entry.getValue();
			if (className.equals(def.get("fromclass")) || className.equals(def.get("toclass"))) {
				result.add(relationshipView(entry.getKey(), def));
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

	private void validateJoinFields(User user, List<ObjectNode> errors, String lang, Map<String, Object> fromClass,
			Map<String, Object> toClass, String fromField, String toField) {
		boolean required = dataAdapterRegistry.provider(businessConfig(user).getDataAdapter()).requiresJoinFields();
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
