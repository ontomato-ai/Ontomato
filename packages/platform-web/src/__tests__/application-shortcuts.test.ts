import {expect,it} from 'vitest';
import {agentBuilderShortcut, applicationShortcuts} from '../application-shortcuts';
import type {PlatformAppDeclaration} from '../apps';
import {catalogPartition} from '../native-layouts';
import {appDeclarations} from '../partition';
import {catalogFixture, closedAccess, generatedNavigation} from './fixtures';
import {panelEntryApplication, useApplicationCatalog} from '../catalog';
import {platformRoutes} from '@ontomato/platform-shell/routes';
it('bounds personal dynamic shortcuts while preserving the active application and builtins',()=>{
  const app=(id:string):PlatformAppDeclaration=>({id,label:id,icon:'pages',category:'business',prefix:'/'+id});
  const dynamic=Array.from({length:12},(_,index)=>`app-${index}`);
  const shown=applicationShortcuts(['home','application-gallery',...dynamic].map(app),dynamic,dynamic,'app-11');
  expect(shown.filter(item=>dynamic.includes(item.id))).toHaveLength(6);
  expect(shown.map(item=>item.id)).toEqual(expect.arrayContaining(['home','application-gallery','app-11']));
  expect(shown.some(item=>item.id==='app-8')).toBe(false);
});
it('orders the permitted settings shortcut above App Builder and groups only published builder outputs with it',()=>{
  const catalog = catalogFixture();
  const seed = catalog[0]!;
  const built = { ...seed, id: 'app-built', kind: 'hosted' as const, category: 'business' as const, releaseId: 'release-1' };
  const product = { ...built, id: 'app-product', kind: 'product' as const, entry: { path: '/products/app-product?applicationId=app-product' } };
  const panels = { ...product, id: 'app-panel', releaseId: null, entry: { path: '/panel', renderer: 'panels' } };
  const connected = { ...built, id: 'app-connected', kind: 'connected' as const, releaseId: null };
  const apps = appDeclarations(generatedNavigation(), closedAccess(['analysis-agent']),
    catalogPartition([...catalog, built, product, panels, connected], 'en'), key => key);
  const applications = useApplicationCatalog().applications;
  const before = applications.value;
  const shortcut = () => agentBuilderShortcut(apps, panelEntryApplication(platformRoutes.agents.path) === 'agents', 'Agent Builder');
  applications.value = catalog;
  const allowed = shortcut()!;
  expect(allowed.home).toBe('/agents/settings');
  applications.value = catalog.map(app => app.id === 'agents' ? { ...app, panelUses: [] } : app);
  expect(shortcut()).toBeUndefined();
  applications.value = before;
  const ids = [built.id, connected.id];
  const shown = applicationShortcuts([...apps, allowed], ids, [connected.id], null);
  expect(shown.filter(app => app.rail === 'builders').map(app => app.id)).toEqual(['agent-builder', 'app-builder', built.id, product.id, panels.id]);
  expect(shown.find(app => app.id === built.id)?.built).toBe(true);
  expect(shown.find(app => app.id === connected.id)?.built).toBe(false);
});

it('shows every published builder output without using personal shortcut slots', () => {
  const app = (id: string, built = false): PlatformAppDeclaration => ({id,label:id,icon:'pages',category:'business',prefix:'/'+id,built});
  const built = Array.from({length: 7}, (_, index) => app(`built-${index}`, true));
  const connected = Array.from({length: 6}, (_, index) => app(`connected-${index}`));
  const dynamic = [...built, ...connected].map(item => item.id);
  const shown = applicationShortcuts([app('app-builder'), ...built, ...connected], dynamic, dynamic.slice(0, 6).concat(connected.map(item => item.id)), null);
  expect(shown.filter(item => item.rail === 'builders').map(item => item.id)).toEqual(['app-builder', ...built.map(item => item.id)]);
  expect(shown.filter(item => item.id.startsWith('connected-')).map(item => item.id)).toEqual(connected.slice(0, 5).map(item => item.id));
});
