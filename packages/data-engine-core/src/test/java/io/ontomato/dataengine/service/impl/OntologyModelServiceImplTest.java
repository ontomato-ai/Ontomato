package io.ontomato.dataengine.service.impl;

import static io.ontomato.dataengine.service.OntologyModelService.ATTRIBUTE_TYPES;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import io.ontomato.dataengine.bean.AuditLog;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.AuditLogDao;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterProvider;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.OntologyModelException;
import io.ontomato.dataengine.service.OntologyModelService.AttributeCreate;
import io.ontomato.dataengine.service.OntologyModelService.AttributeUpdate;
import io.ontomato.dataengine.service.OntologyModelService.FormDescription;
import io.ontomato.dataengine.service.OntologyModelService.FormRequest;
import io.ontomato.dataengine.service.OntologyModelService.FormTarget;
import io.ontomato.dataengine.service.OntologyModelService.ObjectTypeCreate;
import io.ontomato.dataengine.service.OntologyModelService.ObjectTypeUpdate;
import io.ontomato.dataengine.service.OntologyModelService.RelationshipCreate;
import io.ontomato.dataengine.service.OntologyModelService.RelationshipUpdate;

/**
 * The ontology model's owner keeps one rule per domain: every write below saves it once, every refusal names the
 * field that failed, and the existing primary-key and join-field rules stay where the owner checks them.
 */
class OntologyModelServiceImplTest {

	private static final String RULE = """
			{"datasetdesc":"","classlist":["Device","Site"],"relationship_rule":{
			  "owns":{"fromclass":"Device","toclass":"Site","desc":"owns","fromField":"site_id","toField":"id","fromdesc":"","todesc":""}
			},"classDef":[
			  {"className":"Device","showName":"Device","classDesc":"","classToCard":false,"instanceToCard":false,"inStarChart":false,
			   "attrs":[
			     {"name":"id","showName":"id","attrDesc":"","type":"varchar","enable":true,"primaryKey":true},
			     {"name":"site_id","showName":"Site","attrDesc":"","type":"varchar","bizzkey":true,"enable":true,"primaryKey":false},
			     {"name":"size","showName":"Size","attrDesc":"","type":"int","bizzkey":false,"enable":true,"primaryKey":false}]},
			  {"className":"Site","showName":"Site","classDesc":"A site","classToCard":false,"instanceToCard":false,"inStarChart":false,
			   "attrs":[{"name":"id","showName":"id","attrDesc":"","type":"varchar","enable":true,"primaryKey":true}]}]}""";

	private final AdminServiceImpl adminService = new AdminServiceImpl();
	private final OntologyModelServiceImpl service = new OntologyModelServiceImpl();
	private final JSONRuleDao jsonRuleDao = mock(JSONRuleDao.class);
	private final AuditLogDao auditLogDao = mock(AuditLogDao.class);
	private final LangService langService = mock(LangService.class);
	private final DataAdapter adapter = mock(DataAdapter.class);
	private final DataAdapterProvider provider = mock(DataAdapterProvider.class);
	private final User user = mock(User.class);
	private final BusinessConfig businessConfig = new BusinessConfig();
	private JSONObject rule;

	@BeforeEach
	void wire() {
		rule = JSON.parseObject(RULE);
		when(jsonRuleDao.query("d1")).thenReturn(rule);
		when(user.getDomainId()).thenReturn("d1");
		when(user.getId()).thenReturn("u1");
		when(user.getUserName()).thenReturn("User");
		businessConfig.setDataAdapter("postgresql");
		businessConfig.setLang("en");

		BusinessConfigService businessConfigService = mock(BusinessConfigService.class);
		when(businessConfigService.get("d1")).thenReturn(businessConfig);
		DataAdapterRegistry registry = mock(DataAdapterRegistry.class);
		when(registry.create(eq(businessConfig), any())).thenReturn(adapter);
		when(registry.provider("postgresql")).thenReturn(provider);
		when(provider.requiresJoinFields()).thenReturn(true);
		when(langService.get(any(), anyString())).thenAnswer(call -> call.getArgument(1));

		ReflectionTestUtils.setField(adminService, "jsonRuleDao", jsonRuleDao);
		ReflectionTestUtils.setField(adminService, "businessConfigService", businessConfigService);
		ReflectionTestUtils.setField(adminService, "dataAdapterRegistry", registry);
		ReflectionTestUtils.setField(adminService, "langService", langService);
		ReflectionTestUtils.setField(adminService, "auditLogDao", auditLogDao);

		ReflectionTestUtils.setField(service, "adminService", adminService);
		ReflectionTestUtils.setField(service, "dataAdapterRegistry", registry);
		ReflectionTestUtils.setField(service, "businessConfigService", businessConfigService);
		ReflectionTestUtils.setField(service, "langService", langService);
		ReflectionTestUtils.setField(service, "auditLogDao", auditLogDao);
	}

	@Test
	void objectTypesReportCountsStoredDescriptionsAndPrimaryKeyStatus() {
		var objectTypes = service.objectTypes(user, "en");

		assertEquals(List.of("Device", "Site"), objectTypes.stream().map(view -> view.className()).toList());
		var device = objectTypes.get(0);
		assertEquals(List.of(3, 1, 1), List.of(device.attributeCount(), device.businessKeyCount(),
				device.relationshipCount()));
		assertEquals("", device.classDesc());
		assertEquals(Map.of("status", "ok", "name", "id"), device.primaryKey());
		var site = objectTypes.get(1);
		assertEquals(List.of(1, 0, 1), List.of(site.attributeCount(), site.businessKeyCount(),
				site.relationshipCount()));
		assertEquals("A site", site.classDesc());
	}

	@Test
	void objectTypePrimaryKeyStatusIsMissingMultipleOrDisabled() {
		var device = (JSONObject) rule.getJSONArray("classDef").get(0);
		var attrs = device.getJSONArray("attrs");
		attrs.getJSONObject(0).put("primaryKey", false);
		assertEquals(Map.of("status", "missing"), service.objectType("Device", user, "en").primaryKey());

		attrs.getJSONObject(1).put("primaryKey", true);
		attrs.getJSONObject(2).put("primaryKey", true);
		assertEquals(Map.of("status", "multiple"), service.objectType("Device", user, "en").primaryKey());

		attrs.getJSONObject(2).put("primaryKey", false);
		attrs.getJSONObject(1).put("enable", false);
		assertEquals(Map.of("status", "disabled", "name", "site_id"),
				service.objectType("Device", user, "en").primaryKey());
	}

	@Test
	void attributeBooleansAcceptTheHistoricalSpellingsAndStringForms() {
		var attrs = ((JSONObject) rule.getJSONArray("classDef").get(0)).getJSONArray("attrs");
		attrs.getJSONObject(0).put("primaryKey", "true");
		attrs.getJSONObject(1).put("bizzkeyBool", " TRUE ");
		attrs.getJSONObject(1).put("primary_key", "true");
		attrs.getJSONObject(1).put("enable", "false");

		var attributes = service.attributes("Device", user, "en");

		assertEquals(List.of("id", "site_id", "size"), attributes.stream().map(attr -> attr.name()).toList());
		assertTrue(attributes.get(0).primaryKey());
		assertTrue(attributes.get(1).businessKey());
		assertTrue(attributes.get(1).primaryKey());
		assertFalse(attributes.get(1).enable());
		assertFalse(attributes.get(2).businessKey());
		assertTrue(attributes.get(2).enable());
	}

	@Test
	void attributeAndRelationshipListsFilterByClassAndEmptyJoinFieldsReadAsEmptyStrings() {
		assertEquals(List.of("id"), service.attributes("Site", user, "en").stream().map(attr -> attr.name()).toList());
		assertEquals(List.of("owns"),
				service.relationships("Site", user, "en").stream().map(rel -> rel.relationship()).toList());

		rule.getJSONObject("relationship_rule").getJSONObject("owns").remove("fromField");
		rule.getJSONObject("relationship_rule").getJSONObject("owns").remove("toField");
		var relation = service.relationship("owns", user, "en");
		assertEquals("", relation.fromField());
		assertEquals("", relation.toField());
	}

	@Test
	void missingObjectsAreNotFoundWithTheirOwnCodes() {
		assertCode(404, "OBJECT_TYPE_NOT_FOUND", () -> service.objectType("Missing", user, "en"));
		assertCode(404, "OBJECT_TYPE_NOT_FOUND", () -> service.attributes("Missing", user, "en"));
		assertCode(404, "RELATIONSHIP_NOT_FOUND", () -> service.relationship("missing", user, "en"));
		assertCode(404, "OBJECT_TYPE_NOT_FOUND", () -> service.deletionImpact("Missing", user, "en"));
		assertCode(404, "ATTRIBUTE_NOT_FOUND",
				() -> service.updateAttribute("Device", "missing", new AttributeUpdate("x", "", true, false), user, "en"));
	}

	@Test
	void creatingAnObjectTypeSavesItsPrimaryKeyAndAuditsOnce() {
		var created = service.createObjectType(new ObjectTypeCreate("Pump", "pump_no", "Pump", ""), user, "en");

		assertEquals("Pump", created.className());
		assertEquals(Map.of("status", "ok", "name", "pump_no"), created.primaryKey());
		Map<String, Object> saved = savedRule();
		var classDef = findClass(saved, "Pump");
		assertEquals("", classDef.get("classDesc"));
		assertEquals(List.of(false, false, false),
				List.of(classDef.get("classToCard"), classDef.get("instanceToCard"), classDef.get("inStarChart")));
		Map<String, Object> key = firstAttr(classDef);
		assertEquals(List.of("pump_no", "pump_no", "varchar", true, true),
				List.of(key.get("name"), key.get("showName"), key.get("type"), key.get("enable"), key.get("primaryKey")));
		assertTrue(((List<String>) saved.get("classlist")).contains("Pump"));
		verify(auditLogDao, times(1)).save(any(AuditLog.class), eq("d1"));
	}

	@Test
	void creatingAnObjectTypeListsEveryInvalidFieldAndSavesNothing() {
		var failure = assertThrows(OntologyModelException.class,
				() -> service.createObjectType(new ObjectTypeCreate("", "1bad", "", ""), user, "en"));

		assertValidation(failure, List.of("/values/className", "/values/showName", "/values/primaryKeyName"),
				List.of("required", "required", "invalid_format"));
		verify(jsonRuleDao, never()).save(any(), any());
	}

	@Test
	void aDuplicateObjectTypeIsRefusedWithoutSaving() {
		var failure = assertThrows(OntologyModelException.class,
				() -> service.createObjectType(new ObjectTypeCreate("Device", "device_no", "Device", ""), user, "en"));

		assertValidation(failure, List.of("/values/className"), List.of("already_exists"));
		verify(jsonRuleDao, never()).save(any(), any());
	}

	@Test
	void theAdapterCanRefuseTheClassNameOrPrimaryKeyName() throws Exception {
		doThrow(new Exception("bad class name")).when(adapter).validateClassNameFormat("Pump");
		var classFailure = assertThrows(OntologyModelException.class,
				() -> service.createObjectType(new ObjectTypeCreate("Pump", "pump_no", "Pump", ""), user, "en"));
		assertValidation(classFailure, List.of("/values/className"), List.of("invalid_format"));

		doThrow(new Exception("bad key name")).when(adapter).validatePrimaryKeyName("pump_no");
		var keyFailure = assertThrows(OntologyModelException.class,
				() -> service.createObjectType(new ObjectTypeCreate("Motor", "pump_no", "Motor", ""), user, "en"));
		assertValidation(keyFailure, List.of("/values/primaryKeyName"), List.of("invalid_format"));
		verify(jsonRuleDao, never()).save(any(), any());
	}

	@Test
	void updatingAnObjectTypeIsOneSaveAndTheNameIsRequired() {
		var updated = service.updateObjectType("Device", new ObjectTypeUpdate("Devices", "A device"), user, "en");

		assertEquals("Devices", updated.showName());
		var classDef = findClass(savedRule(), "Device");
		assertEquals(List.of("Devices", "A device"), List.of(classDef.get("showName"), classDef.get("classDesc")));
		verify(auditLogDao, times(1)).save(any(AuditLog.class), eq("d1"));

		clearInvocations(jsonRuleDao);
		var failure = assertThrows(OntologyModelException.class,
				() -> service.updateObjectType("Device", new ObjectTypeUpdate(" ", "desc"), user, "en"));
		assertValidation(failure, List.of("/values/showName"), List.of("required"));
		verify(jsonRuleDao, never()).save(any(), any());
	}

	@ParameterizedTest
	@ValueSource(strings = {"varchar", "int", "float", "datetime", "boolean", "text"})
	void everyOfferedAttributeTypeCanBeCreated(String type) {
		var created = service.createAttribute("Device",
				new AttributeCreate("extra", "Extra", type, "", true, false, false), user, "en");

		assertEquals(type, created.type());
		var attr = findAttr(findClass(savedRule(), "Device"), "extra");
		assertEquals(type, attr.get("type"));
	}

	@Test
	void creatingAnAttributeSavesItOnceWithItsBusinessKeyAndEnableFlags() {
		service.createAttribute("Device", new AttributeCreate("note", "Note", "text", "d", false, true, false), user,
				"en");

		var attr = findAttr(findClass(savedRule(), "Device"), "note");
		assertEquals(List.of("Note", "text", "d", false, true), List.of(attr.get("showName"), attr.get("type"),
				attr.get("attrDesc"), attr.get("enable"), attr.get("bizzkey")));
		verify(jsonRuleDao, times(1)).save(any(), eq("d1"));
		verify(auditLogDao, times(1)).save(any(AuditLog.class), eq("d1"));
	}

	@Test
	void creatingAnAttributeWithPrimaryKeyClearsTheOldMarkInTheSameWrite() {
		var created = service.createAttribute("Device",
				new AttributeCreate("new_key", "New key", "varchar", "", true, false, true), user, "en");

		assertTrue(created.primaryKey());
		var classDef = findClass(savedRule(), "Device");
		assertEquals(List.of("new_key"), primaryKeyNames(classDef));
		verify(jsonRuleDao, times(1)).save(any(), eq("d1"));
	}

	@Test
	void attributeNameTypeRequiredAndDuplicateRulesAreListedTogether() {
		var failure = assertThrows(OntologyModelException.class,
				() -> service.createAttribute("Device", new AttributeCreate("id", " ", "bucket", "", true, false, false),
						user, "en"));

		assertValidation(failure, List.of("/values/showName", "/values/name", "/values/type"),
				List.of("required", "already_exists", "invalid_option"));
		verify(jsonRuleDao, never()).save(any(), any());
	}

	@Test
	void aPrimaryKeyAttributeMustBeAnEnabledVarchar() {
		var typeFailure = assertThrows(OntologyModelException.class,
				() -> service.createAttribute("Device",
						new AttributeCreate("bad_key", "Bad key", "int", "", true, false, true), user, "en"));
		assertValidation(typeFailure, List.of("/values/type"), List.of("invalid_option"));

		var enableFailure = assertThrows(OntologyModelException.class,
				() -> service.createAttribute("Device",
						new AttributeCreate("bad_key", "Bad key", "varchar", "", false, false, true), user, "en"));
		assertValidation(enableFailure, List.of("/values/enable"), List.of("invalid_option"));
		verify(jsonRuleDao, never()).save(any(), any());
	}

	@Test
	void updatingAnAttributeSavesTheWholeEditableFormAndRefusesDisablingThePrimaryKey() {
		service.updateAttribute("Device", "site_id", new AttributeUpdate("Site link", "", false, true), user, "en");

		var attr = findAttr(findClass(savedRule(), "Device"), "site_id");
		assertEquals(List.of("Site link", "", false, true),
				List.of(attr.get("showName"), attr.get("attrDesc"), attr.get("enable"), attr.get("bizzkey")));
		verify(jsonRuleDao, times(1)).save(any(), eq("d1"));

		clearInvocations(jsonRuleDao);
		var failure = assertThrows(OntologyModelException.class,
				() -> service.updateAttribute("Device", "id", new AttributeUpdate("ID", "", false, false), user, "en"));
		assertCode(409, "PRIMARY_KEY_LOCKED", () -> {
			throw failure;
		});
		verify(jsonRuleDao, never()).save(any(), any());
	}

	@Test
	void switchingThePrimaryKeyMarksOnlyTheTargetAndWritesWithoutAnAudit() {
		var attributes = service.setPrimaryKey("Device", "site_id", user, "en");

		assertEquals(List.of("site_id"), attributes.stream().filter(attr -> attr.primaryKey())
				.map(attr -> attr.name()).toList());
		assertEquals(List.of("site_id"), primaryKeyNames(findClass(savedRule(), "Device")));
		verify(jsonRuleDao, times(1)).save(any(), eq("d1"));
		verifyNoInteractions(auditLogDao);
	}

	@Test
	void switchingThePrimaryKeyKeepsTheExistingEnabledVarcharRules() throws Exception {
		var attrs = ((JSONObject) rule.getJSONArray("classDef").get(0)).getJSONArray("attrs");
		attrs.getJSONObject(2).put("enable", false);
		var failure = assertThrows(OntologyModelException.class,
				() -> service.setPrimaryKey("Device", "size", user, "en"));
		assertValidation(failure, List.of("/values/name"), List.of("invalid_option"));

		doThrow(new Exception("key refused")).when(adapter).validatePrimaryKeyName("site_id");
		var adapterFailure = assertThrows(OntologyModelException.class,
				() -> service.setPrimaryKey("Device", "site_id", user, "en"));
		assertValidation(adapterFailure, List.of("/values/name"), List.of("invalid_format"));
		verify(jsonRuleDao, never()).save(any(), any());
	}

	@Test
	void thePrimaryKeyCannotBeDeletedAndAttributesInUseNameTheirRelationships() {
		var locked = assertThrows(OntologyModelException.class,
				() -> service.deleteAttribute("Device", "id", user, "en"));
		assertCode(409, "PRIMARY_KEY_LOCKED", () -> {
			throw locked;
		});

		var inUse = assertThrows(OntologyModelException.class,
				() -> service.deleteAttribute("Device", "site_id", user, "en"));
		assertCode(409, "ATTRIBUTE_IN_USE", () -> {
			throw inUse;
		});
		assertEquals(List.of("owns"), inUse.details().get("relationships"));
		assertTrue(inUse.getMessage().contains("owns"));
		verify(jsonRuleDao, never()).save(any(), any());
	}

	@Test
	void deletingAnUnusedAttributeSavesAndAuditsOnce() {
		service.deleteAttribute("Device", "size", user, "en");

		assertEquals(List.of("id", "site_id"),
				((List<Map<String, Object>>) findClass(savedRule(), "Device").get("attrs")).stream()
						.map(attr -> attr.get("name")).toList());
		verify(jsonRuleDao, times(1)).save(any(), eq("d1"));
		verify(auditLogDao, times(1)).save(any(AuditLog.class), eq("d1"));
	}

	@Test
	void deletionImpactAndCascadeDeleteAgreeAndRemoveEveryRelationOnce() {
		// A self-loop on the class and a second relationship to the same target.
		rule.getJSONObject("relationship_rule").put("self", selfRelation("Device"));
		rule.getJSONObject("relationship_rule").put("linked",
				JSON.parseObject("{\"fromclass\":\"Device\",\"toclass\":\"Site\",\"desc\":\"linked\","
						+ "\"fromField\":\"site_id\",\"toField\":\"id\",\"fromdesc\":\"\",\"todesc\":\"\"}"));

		var impact = service.deletionImpact("Device", user, "en");
		assertEquals(List.of("owns", "self", "linked"),
				impact.relationships().stream().map(rel -> rel.relationship()).toList());

		var deleted = service.deleteObjectType("Device", user, "en");

		assertEquals(impact.relationships().stream().map(rel -> rel.relationship()).toList(),
				deleted.relationships());
		var saved = savedRule();
		assertEquals(List.of("Site"), ((List<Map<String, Object>>) saved.get("classDef")).stream()
				.map(classDef -> classDef.get("className")).toList());
		assertEquals(List.of("Site"), saved.get("classlist"));
		assertTrue(((Map<?, ?>) saved.get("relationship_rule")).isEmpty());
		verify(jsonRuleDao, times(1)).save(any(), eq("d1"));
		// One class deletion plus one deletion per cascaded relationship.
		verify(auditLogDao, times(4)).save(any(AuditLog.class), eq("d1"));
	}

	@Test
	void relationshipsRequireJoinFieldsFromTheAdapterAndThemBeingAttributesOfEachEnd() {
		var missing = assertThrows(OntologyModelException.class,
				() -> service.createRelationship(new RelationshipCreate("contains", "Device", "Site", "contains", "", ""),
						user, "en"));
		assertValidation(missing, List.of("/values/fromField", "/values/toField"),
				List.of("required", "required"));

		var wrong = assertThrows(OntologyModelException.class,
				() -> service.createRelationship(
						new RelationshipCreate("contains", "Device", "Site", "contains", "nope", "missing"), user, "en"));
		assertValidation(wrong, List.of("/values/fromField", "/values/toField"),
				List.of("invalid_option", "invalid_option"));
		verify(jsonRuleDao, never()).save(any(), any());
	}

	@Test
	void joinFieldsAreOptionalWhenTheAdapterDoesNotJoinOnThem() {
		when(provider.requiresJoinFields()).thenReturn(false);

		var created = service.createRelationship(
				new RelationshipCreate("contains", "Device", "Site", "contains", "", ""), user, "en");

		assertEquals(List.of("", ""), List.of(created.fromField(), created.toField()));
	}

	@Test
	void creatingARelationshipSavesOnceAndAllowsASecondOneBetweenTheSameClasses() {
		service.createRelationship(
				new RelationshipCreate("contains", "Device", "Site", "contains", "site_id", "id"), user, "en");
		service.createRelationship(
				new RelationshipCreate("near", "Device", "Site", "near", "site_id", "id"), user, "en");

		var relationships = (Map<?, ?>) savedRule(2).get("relationship_rule");
		assertEquals(3, relationships.size());
		var def = (Map<?, ?>) relationships.get("contains");
		assertEquals(List.of("Device", "Site", "contains", "site_id", "id", "", ""),
				List.of(def.get("fromclass"), def.get("toclass"), def.get("desc"), def.get("fromField"),
						def.get("toField"), def.get("fromdesc"), def.get("todesc")));
		verify(jsonRuleDao, times(2)).save(any(), eq("d1"));
		verify(auditLogDao, times(2)).save(any(AuditLog.class), eq("d1"));
	}

	@Test
	void relationshipNameDescEndsAndDuplicateRulesAreListedTogether() {
		var failure = assertThrows(OntologyModelException.class,
				() -> service.createRelationship(
						new RelationshipCreate("1bad", "Missing", "Missing", "", "", ""), user, "en"));

		assertValidation(failure, List.of("/values/desc", "/values/relationship", "/values/fromclass",
				"/values/toclass", "/values/fromField", "/values/toField"),
				List.of("required", "invalid_format", "invalid_option", "invalid_option", "required", "required"));

		var duplicate = assertThrows(OntologyModelException.class,
				() -> service.createRelationship(
						new RelationshipCreate("owns", "Device", "Site", "owns", "site_id", "id"), user, "en"));
		assertValidation(duplicate, List.of("/values/relationship"), List.of("already_exists"));
	}

	@Test
	void updatingARelationshipKeepsItsNameAndEndsAndSavesTheFullForm() {
		service.updateRelationship("owns", new RelationshipUpdate("held by", "id", "id"), user, "en");

		var def = (Map<?, ?>) ((Map<?, ?>) savedRule().get("relationship_rule")).get("owns");
		assertEquals(List.of("Device", "Site", "held by", "id", "id"),
				List.of(def.get("fromclass"), def.get("toclass"), def.get("desc"), def.get("fromField"),
						def.get("toField")));
		verify(jsonRuleDao, times(1)).save(any(), eq("d1"));

		var missing = assertThrows(OntologyModelException.class,
				() -> service.updateRelationship("missing", new RelationshipUpdate("d", "", ""), user, "en"));
		assertCode(404, "RELATIONSHIP_NOT_FOUND", () -> {
			throw missing;
		});
	}

	@Test
	void updatingARelationshipRejectsBlankDescriptionsAndJoinFieldsOutsideTheirEnds() {
		var failure = assertThrows(OntologyModelException.class,
				() -> service.updateRelationship("owns", new RelationshipUpdate(" ", "missing", "missing"), user, "en"));

		assertValidation(failure, List.of("/values/desc", "/values/fromField", "/values/toField"),
				List.of("required", "invalid_option", "invalid_option"));
		verify(jsonRuleDao, never()).save(any(), any());
	}

	@Test
	void deletingARelationshipSavesAndAuditsOnceAndMissingOnesAreNotFound() {
		service.deleteRelationship("owns", user, "en");

		assertTrue(((Map<?, ?>) savedRule().get("relationship_rule")).isEmpty());
		verify(jsonRuleDao, times(1)).save(any(), eq("d1"));
		verify(auditLogDao, times(1)).save(any(AuditLog.class), eq("d1"));

		var missing = assertThrows(OntologyModelException.class,
				() -> service.deleteRelationship("missing", user, "en"));
		assertCode(404, "RELATIONSHIP_NOT_FOUND", () -> {
			throw missing;
		});
	}

	@Test
	void theObjectTypeFormOpensAnEditWithItsNameReadOnlyAndTheStoredValues() {
		var form = service.objectTypeForm(open("object", "platform:ObjectType", "Device"), user, "en");

		assertEquals(List.of("/className", "/showName", "/classDesc"), paths(form));
		assertTrue(fieldOf(form, "/className").get("readOnly").asBoolean());
		assertFalse(fieldOf(form, "/showName").get("readOnly").asBoolean());
		assertEquals(Map.of("className", "Device", "showName", "Device", "classDesc", ""), form.values());
		assertEquals("Admin.form.className", fieldOf(form, "/className").get("label").asText());
		assertEquals(List.of("className", "showName"), texts(form.save().bodySchema().get("required")));
		assertEquals("POST", form.save().method());
		assertEquals("/ontology/model/object-type/update", form.save().path());
		assertEquals("objectType.update", form.save().draftOperation());
	}

	@Test
	void theObjectTypeFormOpensTheCreateTargetWithDefaultsAndThePrimaryKeyName() {
		var form = service.objectTypeForm(open("draft", "platform:ObjectType", null), user, "en");

		assertEquals(List.of("/className", "/primaryKeyName", "/showName", "/classDesc"), paths(form));
		assertTrue(form.fields().stream().noneMatch(field -> field.get("readOnly").asBoolean()));
		assertEquals(Map.of("className", "", "primaryKeyName", "", "showName", "", "classDesc", ""), form.values());
		assertEquals(List.of("className", "primaryKeyName", "showName"),
				texts(form.save().bodySchema().get("required")));
		assertEquals("/ontology/model/object-type/create", form.save().path());
		assertEquals("objectType.create", form.save().draftOperation());
	}

	@Test
	void theAttributeFormLocksTheNameTypeAndThePrimaryKeyAttributeOnEdit() {
		var form = service.attributeForm(open("object", "platform:Attribute", "[\"Device\",\"id\"]"), user, "en");

		assertEquals(List.of("/className", "/name", "/type", "/showName", "/attrDesc", "/enable", "/businessKey",
				"/primaryKey"), paths(form));
		assertEquals(List.of(true, true, true), List.of(fieldOf(form, "/className").get("readOnly").asBoolean(),
				fieldOf(form, "/name").get("readOnly").asBoolean(), fieldOf(form, "/type").get("readOnly").asBoolean()));
		var enable = fieldOf(form, "/enable");
		assertTrue(enable.get("readOnly").asBoolean());
		assertEquals("Admin.form.primaryKeyEnableLocked", enable.get("readOnlyReason").asText());
		var primaryKey = fieldOf(form, "/primaryKey");
		assertTrue(primaryKey.get("readOnly").asBoolean());
		assertEquals("Admin.form.primaryKeySwitchHint", primaryKey.get("readOnlyReason").asText());
		assertEquals(Map.of("className", "Device", "name", "id", "type", "varchar", "showName", "id", "attrDesc", "",
				"enable", true, "businessKey", false, "primaryKey", true), form.values());
		assertEquals("attribute.update", form.save().draftOperation());
	}

	@Test
	void theAttributeFormOffersEveryTypeAndOwnerAndOpensCreateEnabled() {
		var form = service.attributeForm(open("draft", "platform:Attribute", null), user, "en");

		assertEquals(List.of("Device", "Site"), optionValues(fieldOf(form, "/className")));
		assertEquals(ATTRIBUTE_TYPES, optionValues(fieldOf(form, "/type")));
		assertFalse(fieldOf(form, "/enable").get("readOnly").asBoolean());
		assertFalse(fieldOf(form, "/primaryKey").get("readOnly").asBoolean());
		assertEquals(Map.of("className", "", "name", "", "type", "", "showName", "", "attrDesc", "", "enable", true,
				"businessKey", false, "primaryKey", false), form.values());
		assertEquals(List.of("className", "name", "showName", "type", "enable", "businessKey"),
				texts(form.save().bodySchema().get("required")));
		assertEquals("attribute.create", form.save().draftOperation());
	}

	@Test
	void theRelationshipFormReasksTheJoinFieldOptionsWhenAnEndClassChanges() {
		var form = service.relationshipForm(open("draft", "platform:Relationship", null), user, "en");

		assertEquals(List.of("/relationship", "/fromclass", "/fromField", "/toclass", "/toField", "/desc"), paths(form));
		assertEquals(List.of(), optionValues(fieldOf(form, "/fromField")));
		assertTrue(fieldOf(form, "/fromclass").get("refreshOnChange").asBoolean());
		assertTrue(fieldOf(form, "/fromField").get("required").asBoolean());

		// A field held for the class before is no longer one of the new class's attributes; a matching one stays.
		var changed = service.relationshipForm(new FormRequest(new FormTarget("draft", "platform:Relationship", null),
				Map.of("relationship", "", "fromclass", "Site", "fromField", "site_id", "toclass", "Device",
						"toField", "id", "desc", ""),
				"/fromclass"), user, "en");
		assertEquals(List.of("id"), optionValues(fieldOf(changed, "/fromField")));
		assertEquals("", changed.values().get("fromField"));
		assertEquals("id", changed.values().get("toField"));
	}

	@Test
	void theRelationshipFormDropsItsJoinFieldRulesWhenTheAdapterDoesNotJoinOnThem() {
		when(provider.requiresJoinFields()).thenReturn(false);

		var form = service.relationshipForm(open("draft", "platform:Relationship", null), user, "en");

		assertFalse(fieldOf(form, "/fromField").get("required").asBoolean());
		assertFalse(fieldOf(form, "/toField").get("required").asBoolean());
		assertEquals(List.of("relationship", "fromclass", "toclass", "desc"),
				texts(form.save().bodySchema().get("required")));
	}

	@Test
	void theRelationshipFormOpensAnEditWithItsNameAndEndsReadOnly() {
		var form = service.relationshipForm(open("object", "platform:Relationship", "owns"), user, "en");

		assertEquals(List.of(true, true, false, true, false, false),
				paths(form).stream().map(path -> fieldOf(form, path).get("readOnly").asBoolean()).toList());
		assertEquals(Map.of("relationship", "owns", "fromclass", "Device", "fromField", "site_id", "toclass", "Site",
				"toField", "id", "desc", "owns"), form.values());
		assertEquals(List.of("id", "site_id", "size"), optionValues(fieldOf(form, "/fromField")));
		assertEquals(List.of("id"), optionValues(fieldOf(form, "/toField")));
		assertEquals("relationship.update", form.save().draftOperation());
	}

	@Test
	void aCompleteObjectTypeDraftIsCheckedAsItsSaveWouldCheckItAndNothingIsWritten() {
		var refused = assertThrows(OntologyModelException.class,
				() -> service.objectTypeForm(new FormRequest(new FormTarget("draft", "platform:ObjectType", null),
						Map.of("className", "", "primaryKeyName", "1bad", "showName", " ", "classDesc", ""), null),
						user, "en"));
		assertValidation(refused, List.of("/values/className", "/values/showName", "/values/primaryKeyName"),
				List.of("required", "required", "invalid_format"));
		verify(jsonRuleDao, never()).save(any(), any());

		var checked = service.objectTypeForm(new FormRequest(new FormTarget("draft", "platform:ObjectType", null),
				Map.of("className", " Pump ", "primaryKeyName", "pump_no", "showName", "Pump", "classDesc", " A pump "),
				null), user, "en");
		assertEquals(Map.of("className", "Pump", "primaryKeyName", "pump_no", "showName", "Pump", "classDesc",
				"A pump"), checked.values());
		verify(jsonRuleDao, never()).save(any(), any());
	}

	@Test
	void anObjectTypeEditDraftChecksTheUpdateAndNormalizesTheTargetIdentity() {
		var checked = service.objectTypeForm(new FormRequest(new FormTarget("object", "platform:ObjectType", "Device"),
				Map.of("className", "Whatever", "showName", " Devices ", "classDesc", "A device"), null), user, "en");
		assertEquals(Map.of("className", "Device", "showName", "Devices", "classDesc", "A device"),
				checked.values());

		var refused = assertThrows(OntologyModelException.class,
				() -> service.objectTypeForm(new FormRequest(new FormTarget("object", "platform:ObjectType", "Device"),
						Map.of("showName", " ", "classDesc", ""), null), user, "en"));
		assertValidation(refused, List.of("/values/showName"), List.of("required"));
		verify(jsonRuleDao, never()).save(any(), any());
	}

	@Test
	void anAttributeDraftIsCheckedAsItsSaveWouldCheckItWithoutWriting() {
		var refused = assertThrows(OntologyModelException.class,
				() -> service.attributeForm(new FormRequest(new FormTarget("draft", "platform:Attribute", null),
						Map.of("className", "Device", "name", "id", "showName", " ", "type", "bucket", "attrDesc", "",
								"enable", true, "businessKey", false, "primaryKey", false),
						null), user, "en"));
		assertValidation(refused, List.of("/values/showName", "/values/name", "/values/type"),
				List.of("required", "already_exists", "invalid_option"));
		verify(jsonRuleDao, never()).save(any(), any());

		var checked = service.attributeForm(new FormRequest(new FormTarget("object", "platform:Attribute",
				"[\"Device\",\"site_id\"]"),
				Map.of("className", "Whatever", "name", "Whatever", "showName", " Site link ", "attrDesc", "d",
						"enable", false, "businessKey", true, "primaryKey", true),
				null), user, "en");
		assertEquals(Map.of("className", "Device", "name", "site_id", "type", "varchar", "showName", "Site link",
				"attrDesc", "d", "enable", false, "businessKey", true, "primaryKey", false), checked.values());
		assertEquals(false, checked.values().get("primaryKey"));
		verify(jsonRuleDao, never()).save(any(), any());
	}

	@Test
	void aDraftThatDisablesThePrimaryKeyAttributeIsRefusedAsTheSaveWouldRefuseIt() {
		var refused = assertThrows(OntologyModelException.class,
				() -> service.attributeForm(new FormRequest(new FormTarget("object", "platform:Attribute",
						"[\"Device\",\"id\"]"),
						Map.of("showName", "ID", "attrDesc", "", "enable", false, "businessKey", false), null), user,
						"en"));
		assertCode(409, "PRIMARY_KEY_LOCKED", () -> {
			throw refused;
		});
		verify(jsonRuleDao, never()).save(any(), any());
	}

	@Test
	void aRelationshipDraftIsCheckedAsItsSaveWouldCheckItAndEditValuesKeepTheStoredEnds() {
		var refused = assertThrows(OntologyModelException.class,
				() -> service.relationshipForm(new FormRequest(new FormTarget("draft", "platform:Relationship", null),
						Map.of("relationship", "contains", "fromclass", "Device", "toclass", "Site", "desc", "",
								"fromField", "nope", "toField", ""), null), user, "en"));
		assertValidation(refused, List.of("/values/desc", "/values/toField", "/values/fromField"),
				List.of("required", "required", "invalid_option"));
		verify(jsonRuleDao, never()).save(any(), any());

		var checked = service.relationshipForm(new FormRequest(new FormTarget("object", "platform:Relationship", "owns"),
				Map.of("relationship", "Whatever", "fromclass", "Whatever", "toclass", "Whatever",
						"desc", " held by ", "fromField", "id", "toField", "id"),
				null), user, "en");
		assertEquals(Map.of("relationship", "owns", "fromclass", "Device", "fromField", "id", "toclass", "Site",
				"toField", "id", "desc", "held by"), checked.values());
		verify(jsonRuleDao, never()).save(any(), any());
	}

	@Test
	void aDraftWithAValueOfTheWrongTypeOrATargetWithoutOneIsRefusedAsAnInvalidRequest() {
		assertCode(400, "INVALID_REQUEST", () -> service.objectTypeForm(new FormRequest(
				new FormTarget("draft", "platform:ObjectType", null),
				Map.of("className", 5, "primaryKeyName", "", "showName", "", "classDesc", ""), null), user, "en"));
		assertCode(400, "INVALID_REQUEST", () -> service.attributeForm(new FormRequest(
				new FormTarget("object", "platform:Attribute", "[\"Device\"]"), Map.of(), null), user, "en"));
		assertCode(400, "INVALID_REQUEST", () -> service.relationshipForm(new FormRequest(
				new FormTarget("clone", "platform:Relationship", null), null, null), user, "en"));
		verify(jsonRuleDao, never()).save(any(), any());
	}

	private static FormRequest open(String kind, String objectType, String primaryKey) {
		return new FormRequest(new FormTarget(kind, objectType, primaryKey), null, null);
	}

	private static List<String> paths(FormDescription form) {
		return form.fields().stream().map(field -> field.get("path").asText()).toList();
	}

	private static ObjectNode fieldOf(FormDescription form, String path) {
		return form.fields().stream()
				.filter(field -> path.equals(field.get("path").asText())).findFirst().orElseThrow();
	}

	private static List<String> texts(JsonNode array) {
		List<String> result = new ArrayList<>();
		array.forEach(node -> result.add(node.asText()));
		return result;
	}

	private static List<String> optionValues(ObjectNode field) {
		List<String> result = new ArrayList<>();
		field.get("control").get("options").forEach(node -> result.add(node.get("value").asText()));
		return result;
	}

	private Map<String, Object> savedRule() {
		return savedRule(1);
	}

	private Map<String, Object> savedRule(int times) {
		ArgumentCaptor<Map<String, Object>> saved = ArgumentCaptor.forClass(Map.class);
		verify(jsonRuleDao, times(times)).save(saved.capture(), eq("d1"));
		return saved.getValue();
	}

	private void assertValidation(OntologyModelException failure, List<String> fields, List<String> codes) {
		assertEquals(422, failure.status());
		assertEquals("FIELD_VALIDATION_FAILED", failure.code());
		var errors = (List<ObjectNode>) failure.details().get("fields");
		assertEquals(fields, errors.stream().map(error -> error.get("field").asText()).toList());
		assertEquals(codes, errors.stream().map(error -> error.get("code").asText()).toList());
	}

	private void assertCode(int status, String code, org.junit.jupiter.api.function.Executable operation) {
		var failure = assertThrows(OntologyModelException.class, operation);
		assertEquals(status, failure.status());
		assertEquals(code, failure.code());
	}

	private static Map<String, Object> findClass(Map<String, Object> rule, String className) {
		return ((List<Map<String, Object>>) rule.get("classDef")).stream()
				.filter(classDef -> className.equals(classDef.get("className"))).findFirst().orElseThrow();
	}

	private static Map<String, Object> findAttr(Map<String, Object> classDef, String name) {
		return ((List<Map<String, Object>>) classDef.get("attrs")).stream()
				.filter(attr -> name.equals(attr.get("name"))).findFirst().orElseThrow();
	}

	private static Map<String, Object> firstAttr(Map<String, Object> classDef) {
		return ((List<Map<String, Object>>) classDef.get("attrs")).get(0);
	}

	private static List<Object> primaryKeyNames(Map<String, Object> classDef) {
		return ((List<Map<String, Object>>) classDef.get("attrs")).stream()
				.filter(attr -> Boolean.TRUE.equals(attr.get("primaryKey"))).map(attr -> attr.get("name")).toList();
	}

	private static Map<String, String> selfRelation(String className) {
		Map<String, String> relation = new java.util.HashMap<>();
		relation.put("fromclass", className);
		relation.put("toclass", className);
		relation.put("desc", "self");
		relation.put("fromField", "id");
		relation.put("toField", "id");
		relation.put("fromdesc", "");
		relation.put("todesc", "");
		return relation;
	}
}
