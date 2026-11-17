export const rendererLabels:Record<string,string>={full:'完整详情',summary:'摘要',card:'卡片',text:'文本上下文','3d':'三维对象',table:'表格',list:'列表',chart:'图表','3d-scene':'三维场景',number:'数值',form:'表单',button:'按钮',dialog:'弹窗',inline:'内嵌操作'};
export function rendererLabel(value:string){return rendererLabels[value]??value;}
