import type {PlatformAppDeclaration} from './apps';
import { platformRoutes } from '@ontomato/platform-shell/routes';

export function agentBuilderShortcut(apps: readonly PlatformAppDeclaration[], opensAgentSettings: boolean, label: string): PlatformAppDeclaration | undefined {
  const path = platformRoutes.agents.path;
  const agents = apps.find(app => app.id === 'agents');
  if (!agents || !opensAgentSettings) return;
  return { id: 'agent-builder', label, icon: 'agent-builder', rail: 'builders', category: 'build', prefix: path, home: path, allowStandalone: agents.allowStandalone };
}

/** Builder outputs sit under their tools; other dynamic entries use bounded personal shortcuts. */
export function applicationShortcuts(apps:readonly PlatformAppDeclaration[],dynamicIds:readonly string[],pinnedIds:readonly string[],activeId:string|null){
  const dynamic=new Set(dynamicIds),byId=new Map(apps.map(app=>[app.id,app]));
  const shortcuts=pinnedIds.filter(id=>dynamic.has(id)&&byId.has(id)&&!byId.get(id)?.built).slice(0,5);
  if(activeId&&dynamic.has(activeId)&&!shortcuts.includes(activeId))shortcuts.push(activeId);
  const shown=new Set(shortcuts);
  return apps.filter(app=>app.id!=='personal-workspace'&&app.id!=='workplace'&&(app.built||!dynamic.has(app.id)||shown.has(app.id))).map(app=>{
    const rail:PlatformAppDeclaration['rail']=app.id==='agent-builder'||app.id==='app-builder'||app.built?'builders':app.id==='ontology'||app.id==='operations'?'apps':app.category==='admin'?'bottom':app.category==='business'?'top':app.rail;
    return {...app,rail};
  }).sort((a,b)=>{
    const group=(app:PlatformAppDeclaration)=>app.rail==='top'?0:app.rail==='builders'?1:app.rail==='bottom'?3:2;
    const rank=(id:string)=>id==='agent-builder'||id==='ontology'?0:id==='app-builder'?1:id==='operations'?2:3;
    return group(a)-group(b)||(group(a)===1||group(a)===2?rank(a.id)-rank(b.id):0);
  });
}
