import { z } from "zod";

/** One catalogue for icon rendering and domain application choices. */
const applicationIconScopes = {
  "app-window": "domain",
  users: "domain",
  "user-cog": "domain",
  microscope: "domain",
  presentation: "domain",
  "graduation-cap": "domain",
  briefcase: "domain",
  "shopping-cart": "domain",
  package: "domain",
  "clipboard-list": "domain",
  chart: "domain",
  "chart-column": "domain",
  wallet: "domain",
  "heart-pulse": "domain",
  building: "domain",
  "building-2": "domain",
  globe: "domain",
  calendar: "domain",
  // These keys share the glyphs of knowledge, governance and permissions in the shell.
  book: "platform",
  "book-open": "domain",
  folder: "domain",
  workflow: "domain",
  "git-branch": "domain",
  "visual-modeling": "domain",
  database: "platform",
  shield: "platform",
  "shield-check": "domain",
  bot: "domain",
  network: "domain",
  boxes: "domain",
  tags: "domain",
  link: "domain",
  function: "domain",
  "mouse-pointer-click": "domain",
  "alarm-clock": "domain",
  puzzle: "domain",
  "share-2": "domain",
  component: "domain",
  layers: "domain",
  "panels-top-left": "domain",
  shapes: "domain",
  table: "domain",
  cpu: "domain",
  server: "domain",
  "key-round": "domain",
  activity: "domain",
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

/** All catalogue icons are available to both platform and domain applications. */
export const domainApplicationIconKeys = applicationIconKeys;
export const domainApplicationIconSchema = z.string().refine(
  (value): value is ApplicationIconKey => applicationIconKeys.some(key => key === value),
  value => ({ message: `Unknown application icon '${value}'. Choose one of ${applicationIconKeys.join(", ")}` }),
);

export function recommendApplicationIcon(text:string):ApplicationIconKey {
 const rules:[RegExp,ApplicationIconKey][]=[
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
