package io.ontomato.dataengine.schedules;

import static io.ontomato.dataengine.schedules.ScheduleJson.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import io.ontomato.dataengine.service.LangService;
import jakarta.mail.Multipart;
import jakarta.mail.Part;
import jakarta.mail.internet.MimeMessage;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

class TaskMailTest {
  private static final UUID RUN_ID = UUID.fromString("80f319b4-b86a-4660-9999-8122bf128481");
  private static final String TITLE = "Private definition title";
  private static final String RESULT = "**Private result**";
  private static final String ERROR = "Private failure <details>";

  @Test
  void actualExecutorWhoSetTheAddressReceivesFullResultAndErrorWithoutPublicOrigin() throws Exception {
    var language = mock(LangService.class);
    when(language.get("en", "scheduledTasks.mail.completedSubject")).thenReturn("Finished: {title}");
    when(language.get("en", "scheduledTasks.mail.failedSubject")).thenReturn("Failed: {title}");
    when(language.get("en", "scheduledTasks.error.run_failed")).thenReturn("Execution failed");
    when(language.get("en", "scheduledTasks.mail.footer")).thenReturn("Sent by Ontomato");
    var mail = new TaskMail(environment(), language);

    var completed = mail.compose(run("executor"), RESULT, null);
    assertTrue(completed.getSubject().contains(TITLE));
    assertEquals(RESULT, body(completed, "text/plain"));
    assertTrue(body(completed, "text/html").contains("<strong>Private result</strong>"));

    var failed = mail.compose(run("executor"), null, new TaskStore.Failure("run_failed", ERROR));
    assertEquals("Execution failed\n" + ERROR, body(failed, "text/plain"));
    assertTrue(body(failed, "text/html").contains("Private failure &lt;details&gt;"));
  }

  @Test
  void otherSetterAndUnknownAttributionReceiveOnlyStatusAndAuthorizedRunLink() throws Exception {
    var env = environment().withProperty("SMTP_PUBLIC_ORIGIN", "https://workbench.example.test:8443")
        .withProperty("PUBLIC_BASE_PATH", "/team");
    var mail = new TaskMail(env, mock(LangService.class));
    String link = "https://workbench.example.test:8443/team/#/schedules?taskId=task%2F%26%20old&runId=" + RUN_ID;

    assertStatusMail(mail.compose(run("creator"), RESULT, null), "Task trigger completed", link);
    assertStatusMail(mail.compose(run(null), null, new TaskStore.Failure("run_failed", ERROR)),
        "Task trigger failed", link);
  }

  @Test
  void statusMailRequiresExternalOrigin() {
    var mail = new TaskMail(environment(), mock(LangService.class));
    assertThrows(IllegalArgumentException.class, () -> mail.compose(run("creator"), RESULT, null));
  }

  private static void assertStatusMail(MimeMessage message, String status, String link) throws Exception {
    assertEquals("recipient@example.test", message.getAllRecipients()[0].toString());
    assertEquals(status, message.getSubject());
    assertEquals(status + "\n\n" + link, body(message, "text/plain"));
    String html = body(message, "text/html");
    assertTrue(html.contains("href=\"" + link.replace("&", "&amp;") + "\""));
    for (String secret : new String[] {TITLE, "Private result", "Private failure"}) {
      assertFalse(html.contains(secret));
    }
  }

  private static String body(Part part, String type) throws Exception {
    if (part instanceof MimeMessage message) message.saveChanges();
    if (part.isMimeType(type)) return (String) part.getContent();
    if (part.getContent() instanceof Multipart multipart) {
      for (int i = 0; i < multipart.getCount(); i++) {
        String value = body(multipart.getBodyPart(i), type);
        if (value != null) return value;
      }
    }
    return null;
  }

  private static MockEnvironment environment() {
    return new MockEnvironment().withProperty("SMTP_FROM", "sender@example.test");
  }

  private static TaskStore.Run run(String setter) {
    var definition = new TaskDefinition(TITLE, "agents", object(), "v1", object(), "UTC",
        "recipient@example.test", null, "application", null);
    var snapshot = new TaskStore.Snapshot("domain", "creator", definition, array(), "en", 1, "executor", 1, setter);
    return new TaskStore.Run(RUN_ID, "task/& old", snapshot, "manual", "running",
        null, null, null, null, null, null, null, null, null, null, null, null);
  }
}
