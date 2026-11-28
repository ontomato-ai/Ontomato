import { runtimeRelativePathSchema } from "@ontomato/contracts/agent-runtime-values";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";

const zh = {
  start: "请使用报告技能将当前会话的源报告 ",
  end: " 转为 PPT。按照以下选项编排内容，将 cover 的值原样写入渲染计划的 cover 字段，并在回复中提供生成的 .pptx 文件链接。选项：",
};
const en = {
  start: "Use the report skill to create a PPT from this conversation's source report ",
  end: ". Apply these options, copy the cover value verbatim into the render plan's cover field, and link the resulting .pptx in your reply. Options: ",
};

export function reportPptMessage(artifact: RuntimeArtifact, title: string, settings: object, language: string) {
  const { start, end } = language.startsWith("zh") ? zh : en;
  return start + JSON.stringify({ path: artifact.path, runId: artifact.runId, title }) + end + JSON.stringify(settings);
}

export function readReportPptMessage(message: string) {
  const wording = [zh, en].find(({ start }) => message.startsWith(start));
  if (!wording) return null;
  const payload = message.slice(wording.start.length);
  // The source is a flat JSON object. Find its closing brace outside quoted strings.
  const sourceJson = /^\{(?:[^"{}]|"(?:[^"\\]|\\.)*")*\}/.exec(payload)?.[0];
  if (!sourceJson || !payload.startsWith(wording.end, sourceJson.length)) return null;
  try {
    const source = JSON.parse(sourceJson);
    const settings = JSON.parse(payload.slice(sourceJson.length + wording.end.length));
    const path = runtimeRelativePathSchema.safeParse(source?.path);
    if (!path.success || !path.data.startsWith("outputs/") || !/\.md$/i.test(path.data) ||
      typeof source.runId !== "string" || typeof settings?.instructions !== "string" ||
      (settings.cover !== false && (!settings.cover || typeof settings.cover.title !== "string"))) return null;
    const fallback = path.data.split("/").at(-1)!.replace(/\.md$/i, "");
    return {
      title: typeof source.title === "string" && source.title.trim() ? source.title : fallback,
      path: path.data.replace(/\.md$/i, ".pptx"),
    };
  } catch {
    return null;
  }
}
