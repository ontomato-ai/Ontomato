import type {PlatformAppDeclaration} from './apps';

/** The gallery remains complete; the rail contains a bounded personal selection. */
export function applicationShortcuts(apps:readonly PlatformAppDeclaration[],dynamicIds:readonly string[],pinnedIds:readonly string[],activeId:string|null){
  const dynamic=new Set(dynamicIds),byId=new Map(apps.map(app=>[app.id,app]));
  const shortcuts=pinnedIds.filter(id=>dynamic.has(id)&&byId.has(id)).slice(0,5);
  if(activeId&&dynamic.has(activeId)&&!shortcuts.includes(activeId))shortcuts.push(activeId);
  const shown=new Set(shortcuts);
  return apps.filter(app=>app.id!=='personal-workspace'&&app.id!=='workplace'&&(!dynamic.has(app.id)||shown.has(app.id))).map(app=>{
    const rail:PlatformAppDeclaration['rail']=app.id==='agent-builder'||app.id==='app-builder'||app.id.startsWith('app-')&&app.category==='business'?'builders':app.id==='ontology'||app.id==='governance'||app.id==='operations'?'apps':app.category==='admin'?'bottom':app.category==='business'?'top':app.rail;
    return {...app,rail};
  }).sort((a,b)=>{
    const group=(app:PlatformAppDeclaration)=>app.rail==='top'?0:app.rail==='builders'?1:app.rail==='bottom'?3:2;
    const rank=(id:string)=>id==='agent-builder'||id==='ontology'?0:id==='app-builder'||id==='governance'?1:id==='operations'?2:3;
    return group(a)-group(b)||(group(a)===1||group(a)===2?rank(a.id)-rank(b.id):0);
  });
}
