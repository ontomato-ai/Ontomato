package io.ontomato.dataengine.schedules;

import static io.ontomato.dataengine.schedules.ScheduleJson.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import io.ontomato.dataengine.service.LangService;
import jakarta.mail.Multipart;
import jakarta.mail.Part;
import jakarta.mail.internet.MimeMessage;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
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

    var completed = mail.compose(run("executor", "en"), RESULT, null);
    assertTrue(completed.getSubject().contains(TITLE));
    assertEquals(RESULT, body(completed, "text/plain"));
    assertTrue(body(completed, "text/html").contains("<strong>Private result</strong>"));

    var failed = mail.compose(run("executor", "en"), null, new TaskStore.Failure("run_failed", ERROR));
    assertEquals("Execution failed\n" + ERROR, body(failed, "text/plain"));
    assertTrue(body(failed, "text/html").contains("Private failure &lt;details&gt;"));
  }

  @Test
  void otherSetterAndUnknownAttributionReceiveOnlyStatusAndAuthorizedRunLink() throws Exception {
    var env = environment().withProperty("SMTP_PUBLIC_ORIGIN", "https://workbench.example.test:8443")
        .withProperty("PUBLIC_BASE_PATH", "/team");
    var language = mock(LangService.class);
    when(language.get("fr", "scheduledTasks.mail.completedStatus")).thenReturn("Exécution terminée");
    when(language.get("fr", "scheduledTasks.mail.failedStatus")).thenReturn("Échec de l’exécution");
    var mail = new TaskMail(env, language);
    String link = "https://workbench.example.test:8443/team/#/schedules?selectedTask=task%2F%26%20old&runId=" + RUN_ID;

    assertStatusMail(mail.compose(run("creator", "fr"), RESULT, null), "Exécution terminée", link);
    assertStatusMail(mail.compose(run(null, "fr"), null, new TaskStore.Failure("run_failed", ERROR)),
        "Échec de l’exécution", link);
  }

  @Test
  void badOriginSkipsStatusMailAndLogsSafeConfigurationGuidance() {
    var logger = (Logger) LoggerFactory.getLogger(TaskMail.class);
    var warnings = new ListAppender<ILoggingEvent>();
    warnings.start();
    logger.addAppender(warnings);
    try {
      var env = environment().withProperty("SMTP_HOST", "unused.example.test");
      var language = mock(LangService.class);
      var run = run("creator", "en");
      new TaskMail(env, language).send(run, RESULT, null);

      env.setProperty("SMTP_PUBLIC_ORIGIN", "https://user:secret@invalid host");
      new TaskMail(env, language).send(run, null, new TaskStore.Failure("run_failed", ERROR));

      assertEquals(2, warnings.list.size());
      assertTrue(warnings.list.get(0).getFormattedMessage().contains("SMTP_PUBLIC_ORIGIN is unset"));
      assertTrue(warnings.list.get(1).getFormattedMessage().contains("SMTP_PUBLIC_ORIGIN is invalid"));
      for (var warning : warnings.list) {
        String message = warning.getFormattedMessage();
        assertTrue(message.contains("Status-only mail skipped"));
        assertTrue(message.contains("external workbench HTTP(S) origin"));
        assertFalse(message.contains("secret"));
        assertFalse(message.contains(RESULT));
        assertFalse(message.contains(ERROR));
        assertNull(warning.getThrowableProxy());
      }
    } finally {
      logger.detachAppender(warnings);
      warnings.stop();
    }
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

  private static TaskStore.Run run(String setter, String locale) {
    var definition = new TaskDefinition(TITLE, "agents", object(), "v1", object(), "UTC",
        "recipient@example.test", null, "application", null);
    var snapshot = new TaskStore.Snapshot("domain", "creator", definition, array(), locale, 1, "executor", 1, setter);
    return new TaskStore.Run(RUN_ID, "task/& old", snapshot, "manual", "running",
        null, null, null, null, null, null, null, null, null, null, null, null);
  }
}
