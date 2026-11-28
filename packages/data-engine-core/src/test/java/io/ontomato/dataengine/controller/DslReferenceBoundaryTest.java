package io.ontomato.dataengine.controller;

import static org.hamcrest.Matchers.containsString;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.OntologyQueryService;
import io.ontomato.dataengine.service.QueryAccessService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.FileUtil;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class DslReferenceBoundaryTest {
  @ParameterizedTest
  @CsvSource({"person, text, boost", "/sensor, bucket, asserts"})
  void referenceIncludesTheSelectedClassTypesInRulesAndExample(
      String className, String additionalType, String syntaxMarker) throws Exception {
    var permission = new UserDataPermission();
    permission.setFullData(true);
    var user = new QueryAccessService.GrantUser("reader", "test-domain");
    var authorization = mock(QueryAccessService.class);
    when(authorization.access(any()))
        .thenReturn(new QueryAccessService.Access(user, permission, null, null, null));
    var admin = mock(AdminService.class);
    when(admin.getJSONRule("test-domain")).thenReturn(Map.of("classDef",
        List.of(JSONObject.of("className", className, "attrs", List.of(
            JSONObject.of("name", "embedding", "type", "vector"),
            JSONObject.of("name", "extra", "type", additionalType))))));
    var controller = new OntologyQueryController(
        authorization, new OntologyQueryService(admin, null, null, null), null, null);
    var http = MockMvcBuilders.standaloneSetup(controller)
        .setMessageConverters(new MappingJackson2HttpMessageConverter())
        .build();

    // The Java application mounts these defaults on its classpath at startup.
    var resources = Path.of("conf-defaults");
    try (var files = mockStatic(FileUtil.class)) {
      files.when(() -> FileUtil.listResourceNames(anyString())).thenAnswer(call -> {
        try (var entries = Files.list(resources.resolve(call.<String>getArgument(0)))) {
          return entries.map(path -> path.getFileName().toString()).toList();
        }
      });
      files.when(() -> FileUtil.getResourceFileLoadAll(anyString(), eq("utf-8")))
          .thenAnswer(call -> Files.readString(resources.resolve(call.<String>getArgument(0))));
      var response = http.perform(post("/ontology/query/dsl-reference")
              .contentType(MediaType.APPLICATION_JSON)
              .content(JSONObject.of("classNames", List.of(className)).toJSONString()))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.classNames[0]").value(className))
          .andExpect(jsonPath("$.syntaxMarkdown", containsString("topK")))
          .andExpect(jsonPath("$.syntaxMarkdown", containsString(syntaxMarker)))
          .andReturn().getResponse().getContentAsString();
      var example = JSONObject.parseObject(response).getString("exampleMarkdown");
      var question = JSONObject.parseObject(example.substring(example.indexOf('{'), example.lastIndexOf('}') + 1));
      var conditions = question.getJSONObject("answer").getJSONArray("steps").getJSONObject(0)
          .getJSONObject("graph").getJSONArray("patterns").getJSONObject(0)
          .getJSONArray("objects").getJSONObject(0).getJSONObject("conditions");
      assertNotNull(conditions.getJSONObject("vector"));
    }
  }
}
