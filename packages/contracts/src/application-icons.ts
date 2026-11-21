import { z } from "zod";

/** One catalogue for icon rendering and domain application choices. */
const applicationIconScopes = {
  "app-window": "domain",
  users: "domain",
  microscope: "domain",
  presentation: "domain",
  "graduation-cap": "domain",
  briefcase: "domain",
  "shopping-cart": "domain",
  package: "domain",
  "clipboard-list": "domain",
  chart: "domain",
  wallet: "domain",
  "heart-pulse": "domain",
  building: "domain",
  globe: "domain",
  calendar: "domain",
  // These keys share the glyphs of knowledge, governance and permissions in the shell.
  book: "platform",
  folder: "domain",
  workflow: "domain",
  database: "platform",
  shield: "platform",
  home: "platform",
  agents: "platform",
  diagnosis: "platform",
  knowledge: "platform",
  objects: "platform",
  ontology: "platform",
  schedule: "platform",
  dashboards: "platform",
  permissions: "platform",
  settings: "platform",
  governance: "platform",
  builder: "platform",
  pages: "domain",
  gallery: "platform",
  "agent-builder": "platform",
} as const;

export type ApplicationIconKey = keyof typeof applicationIconScopes;
export const applicationIconKeys = Object.freeze(Object.keys(applicationIconScopes) as ApplicationIconKey[]);
type DomainApplicationIconKey = {
  [Key in ApplicationIconKey]: typeof applicationIconScopes[Key] extends "domain" ? Key : never
}[ApplicationIconKey];

export const domainApplicationIconKeys = Object.freeze(applicationIconKeys.filter(
  (key): key is DomainApplicationIconKey => applicationIconScopes[key] === "domain",
));
export const domainApplicationIconSchema = z.string().refine(
  (value): value is DomainApplicationIconKey => domainApplicationIconKeys.some(key => key === value),
  value => ({ message: `Icon '${value}' is not available for domain applications. Choose one of ${domainApplicationIconKeys.join(", ")}` }),
);

export function recommendApplicationIcon(text:string):DomainApplicationIconKey {
 const rules:[RegExp,DomainApplicationIconKey][]=[
  [/师资|人员|员工|人事|团队|staff|faculty|employee|team|personnel/i,'users'],
  [/科研|研究|实验|research|science|laboratory/i,'microscope'],
  [/交流|会议|演讲|conference|exchange|presentation/i,'presentation'],
  [/学生|教学|课程|教育|student|course|education/i,'graduation-cap'],
  [/财务|费用|预算|finance|budget|expense/i,'wallet'],
  [/销售|订单|采购|sales|order|purchase/i,'shopping-cart'],
  [/库存|仓储|物流|inventory|warehouse|logistics/i,'package'],
  [/医疗|健康|health|medical/i,'heart-pulse'],
  [/审批|流程|workflow|approval/i,'workflow'],
  [/统计|报表|分析|report|analytics|dashboard/i,'chart'],
  [/项目|任务|project|task/i,'clipboard-list'],
  [/知识|文档|knowledge|document/i,'folder'],
 ];
 return rules.find(([pattern])=>pattern.test(text))?.[1]??'app-window';
}
