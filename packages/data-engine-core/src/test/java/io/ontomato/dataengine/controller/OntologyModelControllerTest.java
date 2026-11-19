package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import com.alibaba.fastjson2.JSON;

import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.FormFields;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.OntologyModelException;
import io.ontomato.dataengine.service.OntologyModelService;
import io.ontomato.dataengine.service.OntologyModelService.AttributeUpdate;
import io.ontomato.dataengine.service.OntologyModelService.ClassDeletion;
import io.ontomato.dataengine.service.OntologyModelService.ObjectTypeCreate;
import io.ontomato.dataengine.service.OntologyModelService.ObjectTypeUpdate;
import io.ontomato.dataengine.service.OntologyModelService.ObjectTypeView;
import io.ontomato.dataengine.util.SpringBeanUtil;

/**
 * The HTTP boundary binds the request body with Jackson into the request records and answers refusals with the
 * platform's {@code {error, correlationId}} shape, including the per-field list of a 422.
 */
class OntologyModelControllerTest {

	private final OntologyModelController controller = new OntologyModelController();
	private final OntologyModelService service = mock(OntologyModelService.class);
	private final User user = mock(User.class);

	@BeforeEach
	void wire() {
		IdentityService identityService = mock(IdentityService.class);
		when(identityService.getCurrentUser()).thenReturn(user);
		GenericApplicationContext context = new GenericApplicationContext();
		context.registerBean(IdentityService.class, () -> identityService);
		context.refresh();
		new SpringBeanUtil().setApplicationContext(context);
		ReflectionTestUtils.setField(controller, "service", service);
	}

	@Test
	void aCreateBodyReachesTheOwnerAsItsRecordAndAnswersCreated() throws Exception {
		when(service.createObjectType(any(), eq(user), eq("en"))).thenReturn(
				new ObjectTypeView("Pump", "Pump", "", 1, 0, 0, Map.of("status", "ok", "name", "pump_no")));

		var response = mvc().perform(post("/ontology/model/object-type/create")
				.header("Accept-Language", "en")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"className":"Pump","primaryKeyName":"pump_no","showName":"Pump","classDesc":""}
						"""))
				.andExpect(status().isCreated()).andReturn().getResponse();

		var body = JSON.parseObject(response.getContentAsString());
		assertEquals("Pump", body.getString("className"));
		assertEquals("ok", body.getJSONObject("primaryKey").getString("status"));
		var bound = ArgumentCaptor.forClass(ObjectTypeCreate.class);
		verify(service).createObjectType(bound.capture(), eq(user), eq("en"));
		assertEquals(List.of("Pump", "pump_no", "Pump", ""),
				List.of(bound.getValue().className(), bound.getValue().primaryKeyName(),
						bound.getValue().showName(), bound.getValue().classDesc()));
	}

	@Test
	void anInvalidBodyAnswers422WithTheFieldList() throws Exception {
		when(service.createObjectType(any(), eq(user), eq("en")))
				.thenThrow(OntologyModelException.validation(
						List.of(FormFields.error("/values/showName", "required", "A display name is required"),
								FormFields.error("/values/primaryKeyName", "invalid_format", "Invalid attribute format")),
						"Some fields are invalid"));

		var response = mvc().perform(post("/ontology/model/object-type/create")
				.header("Accept-Language", "en")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"className":"Pump","primaryKeyName":"1bad","showName":"","classDesc":""}
						"""))
				.andExpect(status().isUnprocessableEntity()).andReturn().getResponse();

		var body = JSON.parseObject(response.getContentAsString());
		assertNotNull(body.getString("correlationId"));
		var error = body.getJSONObject("error");
		assertEquals("FIELD_VALIDATION_FAILED", error.getString("code"));
		var fields = error.getJSONArray("fields");
		assertEquals(List.of("/values/showName", "/values/primaryKeyName"),
				fields.stream().map(field -> ((com.alibaba.fastjson2.JSONObject) field).getString("field")).toList());
		assertEquals(List.of("required", "invalid_format"),
				fields.stream().map(field -> ((com.alibaba.fastjson2.JSONObject) field).getString("code")).toList());
		assertEquals("A display name is required",
				fields.getJSONObject(0).getString("message"));
	}

	@Test
	void aMissingObjectTypeAnswers404WithItsCode() throws Exception {
		when(service.objectType("Missing", user, "en")).thenThrow(
				OntologyModelException.notFound("OBJECT_TYPE_NOT_FOUND", "Class not found"));

		var response = mvc().perform(get("/ontology/model/object-type")
				.param("className", "Missing")
				.header("Accept-Language", "en"))
				.andExpect(status().isNotFound()).andReturn().getResponse();

		var error = JSON.parseObject(response.getContentAsString()).getJSONObject("error");
		assertEquals("OBJECT_TYPE_NOT_FOUND", error.getString("code"));
		assertEquals("Class not found", error.getString("message"));
	}

	@Test
	void aStoredModelThatBreaksThePrimaryKeyRuleAnswers409WithTheReason() throws Exception {
		when(service.updateObjectType(eq("Pump"), any(), eq(user), eq(null))).thenThrow(
				new IllegalArgumentException("Class [Legacy] must have exactly one attribute marked primaryKey=true, but found 0"));

		var response = mvc().perform(post("/ontology/model/object-type/update")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"className":"Pump","showName":"Pump","classDesc":""}
						"""))
				.andExpect(status().isConflict()).andReturn().getResponse();

		var error = JSON.parseObject(response.getContentAsString()).getJSONObject("error");
		assertEquals("MODEL_INVALID", error.getString("code"));
		assertEquals("Class [Legacy] must have exactly one attribute marked primaryKey=true, but found 0",
				error.getString("message"));
	}

	@Test
	void updatesAndDeletionsBindTheirPathAndBody() throws Exception {
		when(service.updateObjectType(eq("Device"), any(), eq(user), eq("en"))).thenReturn(
				new ObjectTypeView("Device", "Devices", "A device", 1, 0, 0, Map.of("status", "ok", "name", "id")));
		when(service.deleteObjectType("Device", user, "en")).thenReturn(new ClassDeletion(List.of("owns")));

		var update = mvc().perform(post("/ontology/model/object-type/update")
				.header("Accept-Language", "en")
				.contentType(MediaType.APPLICATION_JSON)
				.content("{\"className\":\"Device\",\"showName\":\"Devices\",\"classDesc\":\"A device\"}"))
				.andExpect(status().isOk()).andReturn().getResponse();
		assertEquals("Devices", JSON.parseObject(update.getContentAsString()).getString("showName"));
		verify(service).updateObjectType(eq("Device"), eq(new ObjectTypeUpdate("Devices", "A device")), eq(user),
				eq("en"));

		var deleted = mvc().perform(post("/ontology/model/object-type/delete")
				.header("Accept-Language", "en")
				.contentType(MediaType.APPLICATION_JSON)
				.content("{\"className\":\"Device\"}"))
				.andExpect(status().isOk()).andReturn().getResponse();
		assertEquals(List.of("owns"), JSON.parseObject(deleted.getContentAsString()).getJSONArray("relationships").stream().toList());
	}

	@Test
	void anAttributeUpdateBodyIsBoundAsItsRecord() throws Exception {
		when(service.updateAttribute(eq("Device"), eq("site_id"), any(), eq(user), eq("en")))
				.thenReturn(new OntologyModelService.AttributeView("Device", "site_id", "Site", "varchar", "", true,
						true, false));

		mvc().perform(post("/ontology/model/attribute/update")
				.header("Accept-Language", "en")
				.contentType(MediaType.APPLICATION_JSON)
				.content("{\"className\":\"Device\",\"name\":\"site_id\",\"showName\":\"Site\","
						+ "\"attrDesc\":\"\",\"enable\":true,\"businessKey\":true}"))
				.andExpect(status().isOk());

		verify(service).updateAttribute(eq("Device"), eq("site_id"),
				eq(new AttributeUpdate("Site", "", true, true)), eq(user), eq("en"));
	}

	private MockMvc mvc() {
		return MockMvcBuilders.standaloneSetup(controller)
				.setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
	}
}
