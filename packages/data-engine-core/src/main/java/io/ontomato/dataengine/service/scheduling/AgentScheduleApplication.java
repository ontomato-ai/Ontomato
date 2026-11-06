package io.ontomato.dataengine.service.scheduling;

import com.fasterxml.jackson.databind.JsonNode;
import io.ontomato.dataengine.schedules.*;
import org.springframework.stereotype.Component;

/** The agent application's existing per-creator quota accompanies its workbench adapter. */
@Component
public class AgentScheduleApplication implements ScheduleApplication {
  private final ScheduleApplication delegate;

  public AgentScheduleApplication(WorkbenchScheduleApplications workbench) {
    delegate = workbench.application("agents");
  }

  public String id() {
    return delegate.id();
  }

  public String description(String locale) {
    return delegate.description(locale);
  }

  public boolean remote() {
    return true;
  }

  public int creatorLimit() {
    return 50;
  }

  public void authorize(Actor actor) {
    delegate.authorize(actor);
  }

  public JsonNode describe(Actor actor) {
    return delegate.describe(actor);
  }

  public JsonNode form(FormInput input, Actor actor) {
    return delegate.form(input, actor);
  }

  public Validation validate(TaskDefinition definition, Actor actor) {
    return delegate.validate(definition, actor);
  }

  public JsonNode start(Execution execution, Actor actor) {
    return delegate.start(execution, actor);
  }

  public JsonNode status(Execution execution, JsonNode handle) {
    return delegate.status(execution, handle);
  }
}
