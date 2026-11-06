package io.ontomato.dataengine.schedules;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class ScheduleApplications {
  private final Map<String, ScheduleApplication> local = new LinkedHashMap<>();
  private final WorkbenchScheduleApplications workbench;

  public ScheduleApplications(
      List<ScheduleApplication> declarations, WorkbenchScheduleApplications workbench) {
    this.workbench = workbench;
    for (var application : declarations)
      if (local.putIfAbsent(application.id(), application) != null)
        throw new IllegalStateException("Duplicate scheduled application: " + application.id());
  }

  public Map<String, ScheduleApplication> all() {
    var result = new LinkedHashMap<>(local);
    for (String id : workbench.ids()) {
      var existing = result.get(id);
      if (existing != null && !existing.remote())
        throw new IllegalStateException("Duplicate scheduled application: " + id);
      if (existing == null) result.put(id, workbench.application(id));
    }
    return result;
  }

  public void detach(java.util.UUID taskId) {
    for (var application : local.values()) application.detach(taskId);
  }

  public ScheduleApplication require(String id) {
    var application = local.get(id);
    if (application != null) return application;
    if (workbench.ids().contains(id)) return workbench.application(id);
    throw new ScheduleException(
        404, "APPLICATION_NOT_FOUND", "Scheduled application not installed");
  }
}
