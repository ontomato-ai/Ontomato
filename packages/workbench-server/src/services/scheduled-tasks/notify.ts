import { Marked } from "marked";
import { createTransport } from "nodemailer";
import { environment } from "../../config/environment";
import { tForLocale } from "../../i18n";
import { createLogger } from "../../logging/logger";
import { workbenchProduct } from "../../product/installed";
import { productMarkdownOptions } from "../analysis-agent/delivery/marked";
import type { RunFailure } from "./store";

const logger = createLogger("scheduled-task-mail");

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Model text is Markdown; raw HTML in it is shown as text, never interpreted by the mail client. */
const mailMarkdown = new Marked(productMarkdownOptions, {
  renderer: {
    html: ({ text }) => escapeHtml(text),
  },
});

export interface RunMail {
  to: string;
  locale: string;
  agentName: string;
  prompt: string;
  /** The agent's final answer, Markdown; absent on failure. */
  answer?: string;
  failure?: RunFailure;
}

const TITLE_LIMIT = 60;

/** Sends a scheduled run's result. Mail is best effort: without SMTP or on a send error it is logged and dropped. */
export async function sendRunMail(mail: RunMail): Promise<void> {
  const smtp = environment.smtp();
  if (!smtp.host) {
    logger.warn("Scheduled task mail skipped: SMTP_HOST is not configured");
    return;
  }
  const t = (key: string, params?: Record<string, unknown>) => tForLocale(mail.locale, `scheduledTasks.mail.${key}`, params);
  const oneLine = mail.prompt.replace(/\s+/g, " ").trim();
  const title = oneLine.length > TITLE_LIMIT ? `${oneLine.slice(0, TITLE_LIMIT)}…` : oneLine;
  const subject = mail.failure ? t("failedSubject", { title }) : t("completedSubject", { title });
  const row = (label: string, value: string) =>
    `<tr><td style="padding:8px 12px;background:#f8f9fa;font-weight:600;width:100px;vertical-align:top">${escapeHtml(label)}</td><td style="padding:8px 12px;white-space:pre-wrap">${escapeHtml(value)}</td></tr>`;
  const answer = mail.answer?.trim()
    ? (mailMarkdown.parse(mail.answer) as string).replace(
        /<table>/g,
        '<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">',
      )
    : "";
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#333;line-height:1.6">
<div style="max-width:800px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 16px">${escapeHtml(subject)}</h2>
<table style="width:100%;border-collapse:collapse;margin-bottom:20px">
${row(t("agent"), mail.agentName)}
${row(t("prompt"), mail.prompt)}
${mail.failure ? row(t("error"), [tForLocale(mail.locale, `scheduledTasks.error.${mail.failure.code}`), mail.failure.message].filter(Boolean).join("\n")) : ""}
</table>
${answer ? `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px 20px;margin-bottom:16px">${answer}</div>` : mail.failure ? "" : `<p>${escapeHtml(t("noAnswer"))}</p>`}
<p style="color:#6b7280">${escapeHtml(t("openHint"))}</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px">
<div style="font-size:12px;color:#9ca3af">${escapeHtml(workbenchProduct().emailFooter)}</div>
</div></body></html>`;
  try {
    await createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      ...(smtp.user && smtp.pass ? { auth: { user: smtp.user, pass: smtp.pass } } : {}),
    }).sendMail({ from: smtp.from, to: mail.to, subject, html });
    logger.info("Scheduled task mail sent", { failed: Boolean(mail.failure) });
  } catch (error) {
    logger.error("Scheduled task mail failed", { errorName: error instanceof Error ? error.name : typeof error, cause: error instanceof Error ? error.message : String(error) });
  }
}
