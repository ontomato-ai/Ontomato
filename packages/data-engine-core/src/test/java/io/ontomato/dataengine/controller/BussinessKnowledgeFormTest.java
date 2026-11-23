package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.dao.KnowledgeEntity;
import io.ontomato.dataengine.service.KnowledgeService;
import io.ontomato.dataengine.service.KnowledgeTagConfig;
import io.ontomato.dataengine.service.impl.LangServiceImpl;

class BussinessKnowledgeFormTest {

	private final KnowledgeService knowledge = mock(KnowledgeService.class);
	private final LangServiceImpl lang = new LangServiceImpl();
	private KnowledgeTagConfig tags;

	@BeforeEach
	void setup() throws Exception {
		var english = JSON.parseArray(Files.readString(Path.of("conf-defaults/lang/en.json")));
		ReflectionTestUtils.setField(lang, "langMap", Map.of("en", english));
		tags = new KnowledgeTagConfig(JSON.parseObject(Files.readString(Path.of("conf-defaults/business-knowledge.json"))));
	}

	private static Map<String, Object> request(Object target, Object values) {
		var request = new HashMap<String, Object>();
		request.put("target", target);
		request.put("changedField", null);
		if (values != null)
			request.put("values", values);
		return request;
	}

	private static JSONObject field(JSONObject form, String path) {
		for (Object item : form.getJSONArray("fields"))
			if (path.equals(((JSONObject) item).getString("path")))
				return (JSONObject) item;
		throw new AssertionError("No field " + path);
	}

	private static KnowledgeEntity entry(String id, String title, String text, List<String> tags, int status) {
		var entity = new KnowledgeEntity();
		entity.setKnowledgeID(id);
		entity.setKnowledgeTitle(title);
		entity.setKnowledgeText(text);
		entity.setKnowledgeTags(tags);
		entity.setStatus(status);
		return entity;
	}

	@Test
	void createDescribesTheFieldsAndValuesOfANewEntry() {
		JSONObject form = BussinessKnowledgeForm.describe("en", "domain-a",
				request(Map.of("kind", "draft"), null), knowledge, lang, tags);

		JSONObject values = form.getJSONObject("values");
		assertEquals("", values.getString("knowledgeID"));
		assertEquals("", values.getString("knowledgeTitle"));
		assertEquals("", values.getString("knowledgeText"));
		assertTrue(values.getJSONArray("knowledgeTags").isEmpty());
		assertEquals(1, values.getIntValue("status"));

		JSONObject save = form.getJSONObject("save");
		assertEquals("POST", save.getString("method"));
		assertEquals("/admin/addBussinessKnowledge", save.getString("path"));
		assertEquals("knowledge.create", save.getString("draftOperation"));
		assertEquals("integer", save.getJSONObject("bodySchema").getJSONObject("properties")
				.getJSONObject("status").getString("type"));
		assertEquals("array", save.getJSONObject("bodySchema").getJSONObject("properties")
				.getJSONObject("knowledgeTags").getString("type"));

		JSONObject title = field(form, "/knowledgeTitle");
		assertFalse(title.getString("label").isBlank());
		assertTrue(title.getBooleanValue("required"));
		assertEquals("text", title.getJSONObject("control").getString("kind"));
		assertFalse(title.getJSONObject("control").getString("placeholder").isBlank());
		assertNotEquals("Admin.knowledge.form.titlePlaceholder", title.getJSONObject("control").getString("placeholder"));

		JSONObject content = field(form, "/knowledgeText");
		assertTrue(content.getJSONObject("control").getBooleanValue("multiline"));
		assertEquals(8, content.getJSONObject("control").getIntValue("rows"));
		assertFalse(content.getJSONObject("control").getString("placeholder").isBlank());
		assertNotEquals("Admin.knowledge.form.contentPlaceholder", content.getJSONObject("control").getString("placeholder"));
		assertTrue(content.getBooleanValue("required"));

		JSONObject tags = field(form, "/knowledgeTags");
		JSONObject tagsControl = tags.getJSONObject("control");
		assertEquals("select", tagsControl.getString("kind"));
		assertTrue(tagsControl.getBooleanValue("multiple"));
		assertTrue(tagsControl.getBooleanValue("allowCreate"));
		assertFalse(tagsControl.getString("placeholder").isBlank());
		assertNotEquals("Admin.knowledge.form.tagsPlaceholder", tagsControl.getString("placeholder"));
		assertEquals(List.of("General", "Business", "Tech"),
				List.of(tagsControl.getJSONArray("options").getJSONObject(0).getString("value"),
						tagsControl.getJSONArray("options").getJSONObject(1).getString("value"),
						tagsControl.getJSONArray("options").getJSONObject(2).getString("value")));
		assertEquals("array", tags.getJSONObject("valueSchema").getString("type"));

		JSONObject status = field(form, "/status");
		assertEquals("radio", status.getJSONObject("control").getString("presentation"));
		var statusOptions = status.getJSONObject("control").getJSONArray("options");
		assertEquals(0, statusOptions.getJSONObject(0).getIntValue("value"));
		assertEquals(1, statusOptions.getJSONObject(1).getIntValue("value"));
		assertFalse(statusOptions.getJSONObject(0).getString("label").isBlank());
		assertNotEquals("Admin.knowledge.form.pending", statusOptions.getJSONObject(0).getString("label"));
		assertEquals("integer", status.getJSONObject("valueSchema").getString("type"));

		assertEquals("hidden", field(form, "/knowledgeID").getJSONObject("control").getString("kind"));
		for (Object rawField : form.getJSONArray("fields")) {
			assertFalse(((JSONObject) rawField).containsKey("defaultValue"),
					"CRUD fields should not declare defaultValue (which adds a Reset-to-default control)");
		}
	}

	@Test
	void updateTakesTheValuesOfTheStoredEntry() {
		when(knowledge.getBussinessKnowledge("domain-a"))
				.thenReturn(Map.of("k1", entry("k1", "Refund rule", "Within 7 days", List.of("Business"), 0)));

		JSONObject form = BussinessKnowledgeForm.describe("en", "domain-a",
				request(Map.of("kind", "object", "objectType", "platform:BusinessKnowledge", "primaryKey", "k1"), null),
				knowledge, lang, tags);

		JSONObject values = form.getJSONObject("values");
		assertEquals("k1", values.getString("knowledgeID"));
		assertEquals("Refund rule", values.getString("knowledgeTitle"));
		assertEquals("Within 7 days", values.getString("knowledgeText"));
		assertEquals(List.of("Business"), values.getJSONArray("knowledgeTags").toJavaList(String.class));
		assertEquals(0, values.getIntValue("status"));
		assertEquals("/admin/editBussinessKnowledge", form.getJSONObject("save").getString("path"));
		assertEquals("knowledge.update", form.getJSONObject("save").getString("draftOperation"));
		verify(knowledge).getBussinessKnowledge("domain-a");
	}

	@Test
	void aSubmittedDraftIsShownAsItIsAndKeepsTheTargetId() {
		when(knowledge.getBussinessKnowledge("domain-a"))
				.thenReturn(Map.of("k1", entry("k1", "Refund rule", "Within 7 days", List.of("Business"), 1)));

		JSONObject form = BussinessKnowledgeForm.describe("en", "domain-a",
				request(Map.of("kind", "object", "objectType", "platform:BusinessKnowledge", "primaryKey", "k1"),
						Map.of("knowledgeTitle", "Refund rule v2", "knowledgeText", "Within 14 days",
								"knowledgeTags", List.of("Business"), "status", 1)),
				knowledge, lang, tags);

		JSONObject values = form.getJSONObject("values");
		assertEquals("k1", values.getString("knowledgeID"));
		assertEquals("Refund rule v2", values.getString("knowledgeTitle"));
		assertEquals("Within 14 days", values.getString("knowledgeText"));
	}

	@Test
	void aDraftWithOnlyTheChangedFieldsIsShownOverTheStoredValues() {
		when(knowledge.getBussinessKnowledge("domain-a"))
				.thenReturn(Map.of("k1", entry("k1", "Refund rule", "Within 7 days", List.of("Business"), 0)));

		JSONObject form = BussinessKnowledgeForm.describe("en", "domain-a",
				request(Map.of("kind", "object", "objectType", "platform:BusinessKnowledge", "primaryKey", "k1"),
						Map.of("knowledgeText", "Within 14 days")),
				knowledge, lang, tags);

		JSONObject values = form.getJSONObject("values");
		assertEquals("k1", values.getString("knowledgeID"));
		assertEquals("Refund rule", values.getString("knowledgeTitle"));
		assertEquals("Within 14 days", values.getString("knowledgeText"));
		assertEquals(List.of("Business"), values.getJSONArray("knowledgeTags").toJavaList(String.class));
		assertEquals(0, values.getIntValue("status"));
	}

	@Test
	void anUnknownTargetIsRefusedWithTheExistingMessage() {
		when(knowledge.getBussinessKnowledge("domain-a")).thenReturn(Map.of());
		var error = assertThrows(IllegalArgumentException.class, () -> BussinessKnowledgeForm.describe("en", "domain-a",
				request(Map.of("kind", "object", "objectType", "platform:BusinessKnowledge", "primaryKey", "missing"), null),
				knowledge, lang, tags));
		assertEquals("Business knowledge not found in the current domain", error.getMessage());
	}

	@Test
	void anotherObjectTypeIsRefused() {
		var error = assertThrows(IllegalArgumentException.class, () -> BussinessKnowledgeForm.describe("en", "domain-a",
				request(Map.of("kind", "object", "objectType", "platform:Skill", "primaryKey", "k1"), null),
				knowledge, lang, tags));
		assertNotEquals("Admin.knowledge.form.invalidTarget", error.getMessage());
		assertFalse(error.getMessage().isBlank());
	}
}
