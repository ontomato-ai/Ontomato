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

  public boolean canEnter(String id, io.ontomato.dataengine.core.bean.User user) {
    return catalog.canEnter(id,user);
  }

  public ScheduleApplication require(String id, String domain) {
    var app = catalog.all().stream().filter(row -> id.equals(row.getString("id"))
        && (row.getString("domainId") == null || domain.equals(row.getString("domainId"))))
        .findFirst().orElseThrow(ScheduleApplications::missing);
    String adapter = app.getString("scheduleAdapter");
    if (adapter == null) throw missing();
    String[] binding = adapter.split(":",2);
    return binding[0].equals("java") ? java.util.Objects.requireNonNull(local.get(binding[1])) : workbench.application(binding[1]);
  }

  private static ScheduleException missing() {
    return new ScheduleException(404, "APPLICATION_NOT_FOUND", "The scheduled application is not installed in this domain");
  }
}
