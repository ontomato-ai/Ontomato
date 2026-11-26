package io.ontomato.dataengine.schedules;

import static io.ontomato.dataengine.schedules.ScheduleJson.parse;
import static org.junit.jupiter.api.Assertions.*;

import io.ontomato.dataengine.schedules.TriggerUpgrade.TaskKey;
import java.util.ArrayList;
import java.util.Map;
import org.junit.jupiter.api.Test;

class TriggerUpgradeReferencesTest {
  @Test
  void mapsTypedReferencesButDoesNotReplaceOpaqueText() {
    var data = parse("""
        {"panelId":"builtin-product-ontology-triggers",
         "inputs":{"selected":{"literal":{"className":"platform:ScheduledTask","primaryKey":"old"}},
                   "other":{"literal":"platform:ScheduledTask~old"}},
         "title":"builtin-product-ontology-triggers", "help":"platform:ScheduledTask~old",
         "members":{"save":{"operation":"platform:ScheduledTask.save"},"create":{"operation":"platform:ScheduledTask.create"},
                    "enable":{"operation":"platform:ScheduledTask.setEnabled"},"delete":{"handlerRef":"platform:ScheduledTask.delete"},
                    "run":{"operation":"schedules.runNow"},"renew":{"operation":"schedules.renewCredential"},
                    "detail":{"data":{"record":"runRecord"},"description":"schedules.runNow"}}}
        """);
    var issues = new ArrayList<String>();
    var mapping = Map.of(new TaskKey("domain-a", "old"), "trigger-a", new TaskKey("domain-b", "old"), "trigger-b");
    TriggerUpgradeReferences.rewrite(data, "domain-b", mapping, issues, "application");
    assertEquals(parse("""
        {"panelId":"builtin-product-scheduled-tasks",
         "inputs":{"selected":{"literal":{"className":"platform:Trigger","primaryKey":"trigger-b"}},
                   "other":{"literal":"platform:Trigger~trigger-b"}},
         "title":"builtin-product-ontology-triggers", "help":"platform:ScheduledTask~old",
         "members":{"save":{"operation":"platform:Trigger.save"},"create":{"operation":"triggers.create"},
                    "enable":{"operation":"triggers.setEnabled"},"delete":{"handlerRef":"triggers.delete"},
                    "run":{"operation":"triggers.runNow"},"renew":{"operation":"triggers.renewCredential"},
                    "detail":{"data":{"record":"runRecord"},"description":"schedules.runNow"}}}
        """), data);
    assertTrue(issues.isEmpty());
  }

  @Test
  void reportsTypedReferenceWithoutAnInDomainMapping() {
    var data = parse("""
        {"objectType":"platform:ScheduledTask","primaryKey":"old"}
        """);
    var issues = new ArrayList<String>();
    TriggerUpgradeReferences.rewrite(data, "domain-b", Map.of(new TaskKey("domain-a", "old"), "trigger-a"), issues, "panel 43");
    assertEquals(java.util.List.of("panel 43 references missing same-domain task old"), issues);
    assertEquals("old", data.path("primaryKey").textValue());
  }
}
