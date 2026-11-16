import {AppWindow,Bot,Box,ChartNoAxesCombined,ContactRound,FileText,Gauge,Layers,LayoutTemplate,ListFilter,MousePointerClick,PanelTop, Puzzle,SlidersHorizontal,Waypoints} from 'lucide-vue-next';

/** Each asset kind has one distinct icon shared by catalogs, authoring and composition previews. */
export const productIcons={
  'object-projection':Box,
  'collection-view':ListFilter,
  'metric-widget':ChartNoAxesCombined,
  'action-view':MousePointerClick,
  page:FileText,
  navigation:Waypoints,
  application:AppWindow,
  'agent-profile':Bot,
  dashboard:Gauge,
  'object-view':ContactRound,
  widget:Puzzle,
  'widget-group':Layers,
  'operation-panel':SlidersHorizontal,
  'layout-template':LayoutTemplate,
  'workspace-block':PanelTop,
};
