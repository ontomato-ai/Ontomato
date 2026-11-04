import { beforeEach, expect, it, vi } from "vitest";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { appTextEn } from "../../../i18n/app-text-en";
import { installWorkbenchProduct } from "../../../product/installed";
import type { WorkbenchProduct } from "../../../product/types";

const sendMail = vi.hoisted(() => vi.fn());
vi.mock("../../../config/mcp", () => ({ getSystemMcpUrl: () => "http://mcp.invalid/mcp", getAnalysisAgentMcpUrlOverride: () => "" }));
vi.mock("../client", () => ({ listMcpTools: async () => [] }));
vi.mock("nodemailer", () => ({ createTransport: () => ({ sendMail }) }));
vi.mock("../../../config/environment", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../config/environment")>();
  return { environment: { ...original.environment, smtp: () => ({ host: "smtp.invalid", port: 25, secure: false, from: "bot@invalid" }) } };
});

const { buildMcpSystemToolsResponse } = await import("../catalog");
const { sendRunMail } = await import("../../scheduled-tasks/notify");

beforeEach(() => {
  configureI18n({
    defaultLocale: "en",
    languageSwitchEnabled: false,
    appTextLocale: "en",
    packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } },
  });
  installWorkbenchProduct({
    analysisMcpServerName: "ontomato-analysis-agents",
    opsMcpServerName: "ontomato-ops-agent",
    systemMcpCatalogName: "ontomato-mcp",
  } as unknown as WorkbenchProduct);
});

/* User-visible product names come from the messages (Agent Platform); MCP names and routes stay the product identifiers. */
it("titles the MCP services with the Agent Platform name and keeps their identifiers", async () => {
  const result = await buildMcpSystemToolsResponse({ protocol: "http", headers: { host: "catalog.test" } }, [], []);
  expect(result.services.map(({ name, title }) => [name, title])).toEqual([
    ["ontomato-mcp", "Agent Platform MCP"],
    ["ontomato-analysis-agents", "Agent Platform Agents MCP"],
    ["ontomato-ops-agent", "Agent Platform Ops Agent MCP"],
  ]);
});

it("signs scheduled-task mail with the Agent Platform name in the recipient's language", async () => {
  await sendRunMail({ to: "a@invalid", locale: "en", agentName: "Analyst", prompt: "Weekly numbers", answer: "Done" });
  const html = String(sendMail.mock.calls[0]?.[0]?.html);
  expect(html).toContain("This email was sent automatically by Agent Platform");
  expect(html).toContain("The full conversation is in the Agent Platform");
});
