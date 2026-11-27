package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.service.authorization.ManagementRequestAccess.Owned;

import io.ontomato.dataengine.panelreads.WorkbenchPanelRead;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import io.ontomato.dataengine.service.agent.AgentHttpException;
import io.ontomato.dataengine.service.identity.AgentExecutionSettings;
import jakarta.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@Owned
public class AgentExecutionController {
  public static final String INTERNAL_PATH = "/internal/agent-execution/**";
  private final WorkbenchServiceAuthentication authentication;
  private final AgentExecutionSettings settings;
  public AgentExecutionController(WorkbenchServiceAuthentication authentication, AgentExecutionSettings settings) {
    this.authentication = authentication;
    this.settings = settings;
  }
  @GetMapping("/platform/agent-execution/options")
  public AgentExecutionSettings.Options options(HttpServletRequest request,
      @RequestParam(defaultValue = "") String keyword, @RequestParam(defaultValue = "1") int pageNum,
      @RequestParam(defaultValue = "20") int pageSize, @RequestParam(required = false) String selected) {
    requirePage(pageNum, pageSize);
    if (selected != null && selected.isBlank())
      throw AgentHttpException.invalid("Selected user id must not be blank");
    return settings.options(request, keyword, pageNum, pageSize, selected);
  }

  @Bean
  WorkbenchPanelRead executionUserOptions() {
    return new WorkbenchPanelRead("platform:User", "options", (subject, parameters) -> {
      if (!(parameters.getOrDefault("keyword", "") instanceof String keyword))
        throw AgentHttpException.invalid("Keyword must be text");
      if (!(parameters.getOrDefault("pageNum", 1) instanceof Integer pageNum)
          || !(parameters.getOrDefault("pageSize", 20) instanceof Integer pageSize))
        throw AgentHttpException.invalid("Invalid page");
      requirePage(pageNum, pageSize);
      return settings.options(subject, keyword, pageNum, pageSize);
    });
  }

  @Bean
  WorkbenchPanelRead executionUserResolve() {
    return new WorkbenchPanelRead("platform:User", "resolve", (subject, parameters) -> {
      if (!(parameters.get("ids") instanceof List<?> values))
        throw AgentHttpException.invalid("Selected user ids must be an array");
      var ids = new ArrayList<String>(values.size());
      for (var value : values) {
        if (!(value instanceof String id) || id.isBlank())
          throw AgentHttpException.invalid("Selected user id must not be blank");
        ids.add(id);
      }
      return settings.selected(subject, ids);
    });
  }

  private static void requirePage(int pageNum, int pageSize) {
    if (pageNum < 1 || pageSize < 1 || pageSize > 100)
      throw AgentHttpException.invalid("Invalid page");
  }

  @PostMapping("/internal/agent-execution/validate-setting")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void validate(HttpServletRequest request, @RequestBody AgentExecutionSettings.Setting body) {
    authentication.authenticate(request);
    settings.validate(body, request);
  }
  @PostMapping("/internal/agent-execution/prepare-setting")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void prepare(HttpServletRequest request, @RequestBody AgentExecutionSettings.Setting body) {
    authentication.authenticate(request);
    settings.prepare(body, request);
  }
  @PostMapping("/internal/agent-execution/resolve")
  public AgentExecutionSettings.Execution resolve(HttpServletRequest request, @RequestBody AgentExecutionSettings.Resolution body) {
    authentication.authenticate(request);
    if (body.agentId() == null || body.agentId().isBlank())
      throw io.ontomato.dataengine.service.agent.AgentHttpException.invalid("Agent id is required");
    return settings.resolve(body);
  }
}
