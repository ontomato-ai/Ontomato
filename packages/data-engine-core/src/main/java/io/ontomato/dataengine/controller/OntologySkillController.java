package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.service.authorization.ManagementRequestAccess.Owned;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.RuntimeCodeClient;
import io.ontomato.dataengine.service.agent.AgentJson;
import io.ontomato.dataengine.service.agent.AgentRuntimeClient;
import io.ontomato.dataengine.service.agent.OntologyAgentAccess;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Owned
@RequestMapping("/platform/ontology-skills")
public class OntologySkillController {
  private final RuntimeCodeClient code;
  private final OntologyAgentAccess access;

  public OntologySkillController(RuntimeCodeClient code, OntologyAgentAccess access) {
    this.code = code;
    this.access = access;
  }

  @PostMapping("/package")
  public AgentRuntimeClient.SkillVersion publish(
      @RequestBody Map<String, Object> input, HttpServletRequest request) throws Exception {
    access.service(request);
    var body = JSONObject.from(input);
    AgentJson.fields(body, "name");
    return code.registerSkill(AgentJson.text(body, "name"));
  }
}
