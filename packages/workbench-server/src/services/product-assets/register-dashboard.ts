import {saveProduct} from './store';
import type {ProductOwner} from './store';
import type {AssistantCredentials} from '../../platform/agent-runtime/runtime';

/** Creation registers the existing dashboard as a reusable product without copying its definition. */
export async function registerDashboardProduct(owner:ProductOwner,dashboard:{id:string;name:string},credentials:AssistantCredentials){
  return saveProduct(owner,`dashboard-${dashboard.id}`,{name:dashboard.name,description:'',visibility:'private',document:{kind:'dashboard',dashboardId:dashboard.id}},0,credentials);
}
