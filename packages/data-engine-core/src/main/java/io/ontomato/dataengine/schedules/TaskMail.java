package io.ontomato.dataengine.schedules;

import static org.springframework.web.util.HtmlUtils.htmlEscape;

import io.ontomato.dataengine.service.LangService;
import lombok.extern.slf4j.Slf4j;
import org.commonmark.ext.gfm.tables.TablesExtension;
import org.commonmark.parser.Parser;
import org.commonmark.renderer.html.HtmlRenderer;
import org.springframework.core.env.Environment;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Component;

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
  private final LangService language;

  TaskMail(Environment env, LangService language) {
    this.language = language;
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
      String locale = run.snapshot().locale();
      String subject =
          language
              .get(
                  locale,
                  "scheduledTasks.mail." + (failure == null ? "completedSubject" : "failedSubject"))
              .replace("{title}", run.snapshot().definition().title().replaceAll("[\\r\\n]+", " "));
      String content =
          failure == null
              ? result
              : language.get(locale, "scheduledTasks.error." + failure.code())
                  + "\n"
                  + java.util.Objects.toString(failure.message(), "");
      String summary =
          content == null || content.isEmpty()
              ? language.get(locale, "scheduledTasks.mail.noAnswer")
              : content;
      String html =
          failure == null
              ? HTML.render(MARKDOWN.parse(summary))
              : "<pre>" + htmlEscape(summary) + "</pre>";
      html =
          "<h2>"
              + htmlEscape(subject)
              + "</h2>"
              + html
              + "<hr><p>"
              + htmlEscape(language.get(locale, "scheduledTasks.mail.footer"))
              + "</p>";
      var mime = sender.createMimeMessage();
      var message = new MimeMessageHelper(mime, true, "UTF-8");
      message.setFrom(from);
      message.setTo(run.snapshot().definition().notifyEmail());
      message.setSubject(subject);
      message.setText(summary, html);
      sender.send(mime);
    } catch (RuntimeException | jakarta.mail.MessagingException e) {
      log.warn("Mail delivery failed for {}: {}", run.taskId(), e.getClass().getSimpleName());
    }
  }
}
