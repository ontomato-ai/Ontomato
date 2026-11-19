package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.KnowledgeEntity;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.KnowledgeService;
import io.ontomato.dataengine.service.impl.LangServiceImpl;
import io.ontomato.dataengine.util.SpringBeanUtil;

/**
 * The form request carries nested objects and arrays; this boundary test passes the body through the real Jackson
 * converter so a change that binds them as another type is caught before a request reaches the owner.
 */
class BussinessKnowledgeFormBoundaryTest {

	private final AdminController controller = new AdminController();
	private final KnowledgeService knowledge = mock(KnowledgeService.class);
	private final User user = mock(User.class);
	private final LangServiceImpl lang = new LangServiceImpl();

	@BeforeEach
	void setup() throws Exception {
		when(user.getDomainId()).thenReturn("domain-a");
		var identity = mock(IdentityService.class);
		when(identity.getCurrentUser()).thenReturn(user);
		var context = new GenericApplicationContext();
		context.registerBean(IdentityService.class, () -> identity);
		context.refresh();
		new SpringBeanUtil().setApplicationContext(context);

		var english = JSON.parseArray(Files.readString(Path.of("conf-defaults/lang/en.json")));
		ReflectionTestUtils.setField(lang, "langMap", Map.of("en", english));
		ReflectionTestUtils.setField(controller, "knowledgeService", knowledge);
		ReflectionTestUtils.setField(controller, "langService", lang);
	}

	@Test
	void jacksonHandsTheNestedTargetAndValuesToTheFormAsMaps() throws Exception {
		var entity = new KnowledgeEntity();
		entity.setKnowledgeID("k1");
		entity.setKnowledgeTitle("Refund rule");
		entity.setKnowledgeText("Within 7 days");
		entity.setKnowledgeTags(List.of("Business"));
		entity.setStatus(1);
		when(knowledge.getBussinessKnowledge("domain-a")).thenReturn(Map.of("k1", entity));

		var mvc = MockMvcBuilders.standaloneSetup(controller)
				.setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
		var response = mvc.perform(post("/admin/bussinessKnowledge/form")
				.header("Accept-Language", "en")
				.contentType(MediaType.APPLICATION_JSON)
				.content("{\"target\":{\"kind\":\"object\",\"objectType\":\"platform:BusinessKnowledge\","
						+ "\"primaryKey\":\"k1\"},"
						+ "\"values\":{\"knowledgeTitle\":\"Refund rule v2\",\"knowledgeText\":\"Within 14 days\","
						+ "\"knowledgeTags\":[\"Business\"],\"status\":0},"
						+ "\"changedField\":null}"))
				.andExpect(status().isOk()).andReturn().getResponse();

		JSONObject form = JSON.parseObject(response.getContentAsString());
		JSONObject values = form.getJSONObject("values");
		assertEquals("k1", values.getString("knowledgeID"));
		assertEquals("Refund rule v2", values.getString("knowledgeTitle"));
		assertEquals("Within 14 days", values.getString("knowledgeText"));
		assertEquals(0, values.getIntValue("status"));
		assertEquals("/admin/editBussinessKnowledge", form.getJSONObject("save").getString("path"));
		verify(knowledge).getBussinessKnowledge("domain-a");
	}

	@Test
	void anUnknownTargetKeepsTheControllersRefusalEnvelope() throws Exception {
		when(knowledge.getBussinessKnowledge("domain-a")).thenReturn(Map.of());

		var mvc = MockMvcBuilders.standaloneSetup(controller)
				.setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
		var response = mvc.perform(post("/admin/bussinessKnowledge/form")
				.header("Accept-Language", "en")
				.contentType(MediaType.APPLICATION_JSON)
				.content("{\"target\":{\"kind\":\"object\",\"objectType\":\"platform:BusinessKnowledge\","
						+ "\"primaryKey\":\"missing\"},\"changedField\":null}"))
				.andExpect(status().isOk()).andReturn().getResponse();

		JSONObject body = JSON.parseObject(response.getContentAsString());
		assertFalse(body.getBooleanValue("success"));
		assertEquals("Business knowledge not found in the current domain", body.getString("message"));
	}
}
