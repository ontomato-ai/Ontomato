import type {PlatformAppDeclaration} from './apps';

/** The gallery remains complete; the rail contains a bounded personal selection. */
export function applicationShortcuts(apps:readonly PlatformAppDeclaration[],dynamicIds:readonly string[],pinnedIds:readonly string[],activeId:string|null){
  const dynamic=new Set(dynamicIds),byId=new Map(apps.map(app=>[app.id,app]));
  const shortcuts=pinnedIds.filter(id=>dynamic.has(id)&&byId.has(id)).slice(0,5);
  if(activeId&&dynamic.has(activeId)&&!shortcuts.includes(activeId))shortcuts.push(activeId);
  const shown=new Set(shortcuts);
  return apps.filter(app=>app.id!=='personal-workspace'&&app.id!=='workplace'&&(!dynamic.has(app.id)||shown.has(app.id))).map(app=>app.id==='operations'?{...app,rail:'bottom' as const}:app).sort((a,b)=>{
    const group=(app:PlatformAppDeclaration)=>app.rail==='top'?0:app.rail==='bottom'?2:1;
    const rank=(id:string)=>id==='agent-builder'?0:id==='app-builder'?1:id==='ontology'?2:3;
    return group(a)-group(b)||(group(a)===1?rank(a.id)-rank(b.id):0);
  });
}
