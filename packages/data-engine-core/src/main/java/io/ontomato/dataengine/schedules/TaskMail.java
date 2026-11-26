package io.ontomato.dataengine.schedules;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.springframework.web.util.HtmlUtils.htmlEscape;

import io.ontomato.dataengine.service.LangService;
import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeMessage;
import java.net.URI;
import lombok.extern.slf4j.Slf4j;
import org.commonmark.ext.gfm.tables.TablesExtension;
import org.commonmark.parser.Parser;
import org.commonmark.renderer.html.HtmlRenderer;
import org.springframework.core.env.Environment;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Component;
import org.springframework.web.util.UriUtils;

@Slf4j
@Component
class TaskMail {
  private static final java.util.List<org.commonmark.Extension> EXTENSIONS =
      java.util.List.of(TablesExtension.create());
  private static final Parser MARKDOWN = Parser.builder().extensions(EXTENSIONS).build();
  private static final HtmlRenderer HTML =
      HtmlRenderer.builder().extensions(EXTENSIONS).escapeHtml(true).sanitizeUrls(true).build();
  private final JavaMailSenderImpl sender = new JavaMailSenderImpl();
  private final String from;
  private final String publicOrigin;
  private final String publicBasePath;
  private final LangService language;

  TaskMail(Environment env, LangService language) {
    this.language = language;
    publicOrigin = env.getProperty("SMTP_PUBLIC_ORIGIN", "");
    publicBasePath = env.getProperty("PUBLIC_BASE_PATH", "");
    sender.setHost(env.getProperty("SMTP_HOST", ""));
    sender.setPort(env.getProperty("SMTP_PORT", Integer.class, 587));
    sender.setUsername(env.getProperty("SMTP_USER", ""));
    sender.setPassword(env.getProperty("SMTP_PASS", ""));
    sender.setDefaultEncoding("UTF-8");
    from = env.getProperty("SMTP_FROM", sender.getUsername());
    var props = sender.getJavaMailProperties();
    boolean secure = env.getProperty("SMTP_SECURE", Boolean.class, false);
    props.setProperty("mail.smtp.ssl.enable", Boolean.toString(secure));
    props.setProperty("mail.smtp.starttls.enable", Boolean.toString(!secure));
    props.setProperty(
        "mail.smtp.auth",
        Boolean.toString(!sender.getUsername().isEmpty() && !sender.getPassword().isEmpty()));
    props.setProperty("mail.smtp.connectiontimeout", "10000");
    props.setProperty("mail.smtp.timeout", "30000");
    props.setProperty("mail.smtp.writetimeout", "30000");
  }

  void send(TaskStore.Run run, String result, TaskStore.Failure failure) {
    if (sender.getHost().isBlank()) {
      log.warn("Mail skipped for {}: SMTP_HOST is unset", run.taskId());
      return;
    }
    try {
      sender.send(compose(run, result, failure));
    } catch (StatusMailConfigurationException e) {
      log.warn("Status-only mail skipped for {}: {}. Set SMTP_PUBLIC_ORIGIN to the external workbench"
              + " HTTP(S) origin (scheme, host and optional port)",
          run.taskId(), e.getMessage());
    } catch (RuntimeException | MessagingException e) {
      log.warn("Mail delivery failed for {}: {}", run.taskId(), e.getClass().getSimpleName());
    }
  }

  MimeMessage compose(TaskStore.Run run, String result, TaskStore.Failure failure) throws MessagingException {
    var snapshot = run.snapshot();
    String locale = snapshot.locale();
    String setter = snapshot.notifyEmailSetBy();
    boolean completed = failure == null;
    String subject;
    String text;
    String html;
    if (setter != null && setter.equals(snapshot.executorId())) {
      subject = language.get(locale, "scheduledTasks.mail." + (completed ? "completedSubject" : "failedSubject"))
          .replace("{title}", snapshot.definition().title().replaceAll("[\\r\\n]+", " "));
      String content = completed ? result : language.get(locale, "scheduledTasks.error." + failure.code())
          + "\n" + java.util.Objects.toString(failure.message(), "");
      text = content == null || content.isEmpty() ? language.get(locale, "scheduledTasks.mail.noAnswer") : content;
      html = "<h2>" + htmlEscape(subject) + "</h2>"
          + (completed ? HTML.render(MARKDOWN.parse(text)) : "<pre>" + htmlEscape(text) + "</pre>")
          + "<hr><p>" + htmlEscape(language.get(locale, "scheduledTasks.mail.footer")) + "</p>";
    } else {
      String link = runLink(run);
      subject = language.get(locale, completed ? "scheduledTasks.mail.completedStatus" : "scheduledTasks.mail.failedStatus");
      text = subject + "\n\n" + link;
      html = "<p>" + htmlEscape(subject) + "</p><p><a href=\"" + htmlEscape(link)
          + "\">" + htmlEscape(link) + "</a></p>";
    }
    var mime = sender.createMimeMessage();
    var message = new MimeMessageHelper(mime, true, "UTF-8");
    message.setFrom(from);
    message.setTo(snapshot.definition().notifyEmail());
    message.setSubject(subject);
    message.setText(text, html);
    return mime;
  }

  private String runLink(TaskStore.Run run) {
    var origin = requirePublicOrigin();
    return origin.getScheme() + "://" + origin.getRawAuthority() + publicBasePath
        + "/#/schedules?taskId=" + UriUtils.encode(run.taskId(), UTF_8) + "&runId=" + run.id();
  }

  private URI requirePublicOrigin() {
    if (publicOrigin.isBlank()) throw new StatusMailConfigurationException("SMTP_PUBLIC_ORIGIN is unset");
    try {
      var origin = URI.create(publicOrigin);
      if (("https".equalsIgnoreCase(origin.getScheme()) || "http".equalsIgnoreCase(origin.getScheme()))
          && origin.getHost() != null && origin.getRawUserInfo() == null
          && (origin.getRawPath().isEmpty() || "/".equals(origin.getRawPath()))
          && origin.getRawQuery() == null && origin.getRawFragment() == null) {
        return origin;
      }
    } catch (IllegalArgumentException ignored) {
      // The URI parser's error may include credentials from the configured value.
    }
    throw new StatusMailConfigurationException("SMTP_PUBLIC_ORIGIN is invalid");
  }

  private static final class StatusMailConfigurationException extends IllegalArgumentException {
    StatusMailConfigurationException(String message) {
      super(message);
    }
  }
}
