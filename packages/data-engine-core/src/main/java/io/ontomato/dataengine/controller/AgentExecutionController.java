package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import io.ontomato.dataengine.service.identity.AgentExecutionSettings;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
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
      @RequestParam(defaultValue = "20") int pageSize) {
    if (pageNum < 1 || pageSize < 1 || pageSize > 100)
      throw io.ontomato.dataengine.service.agent.AgentHttpException.invalid("Invalid page");
    return settings.options(request, keyword, pageNum, pageSize);
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
