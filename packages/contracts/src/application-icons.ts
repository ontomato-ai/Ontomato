/** Stable keys shared by application declarations, builders and the platform shell. */
export const applicationIconKeys = ['app-window','users','microscope','presentation','graduation-cap','briefcase','shopping-cart','package','clipboard-list','chart','wallet','heart-pulse','building','globe','calendar','book','folder','workflow','database','shield','home','agents','diagnosis','knowledge','objects','ontology','schedule','dashboards','permissions','settings','governance','builder','pages','gallery','agent-builder'] as const;
export type ApplicationIconKey = typeof applicationIconKeys[number];
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
  [/知识|文档|knowledge|document/i,'book'],
 ];
 return rules.find(([pattern])=>pattern.test(text))?.[1]??'app-window';
}
