package io.ontomato.dataengine.schedules;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class ScheduleApplications {
  private final Map<String, ScheduleApplication> local = new LinkedHashMap<>();
  private final WorkbenchScheduleApplications workbench;
  private final io.ontomato.dataengine.applications.ApplicationCatalog catalog;

  public ScheduleApplications(
      List<ScheduleApplication> declarations, WorkbenchScheduleApplications workbench, io.ontomato.dataengine.applications.ApplicationCatalog catalog) {
    this.workbench = workbench;
    this.catalog = catalog;
    for (var application : declarations)
      if (local.putIfAbsent(application.id(), application) != null)
        throw new IllegalStateException("Duplicate scheduled application: " + application.id());
  }

  public Map<String, ScheduleApplication> all(String domain) {
    var result = new LinkedHashMap<String, ScheduleApplication>();
    for (var app : catalog.all())
      if (app.getString("scheduleAdapter") != null && (app.getString("domainId") == null || domain.equals(app.getString("domainId"))))
        result.put(app.getString("id"), require(app.getString("id")));
    return result;
  }

  public boolean canEnter(String id, io.ontomato.dataengine.core.bean.User user) {
    return catalog.canEnter(id,user);
  }

  public void detach(java.util.UUID taskId) {
    for (var application : local.values()) application.detach(taskId);
  }

  public ScheduleApplication require(String id) {
    String adapter = catalog.require(id).getString("scheduleAdapter");
    if (adapter == null) throw new ScheduleException(404, "APPLICATION_NOT_FOUND", "Application has no schedule adapter");
    String[] binding = adapter.split(":",2);
    return binding[0].equals("java") ? java.util.Objects.requireNonNull(local.get(binding[1])) : workbench.application(binding[1]);
  }
}
