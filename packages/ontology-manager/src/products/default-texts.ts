import {productDefaultTexts} from '@ontomato/contracts/product-assets';
import {useOntologyText} from '../context';
import type {OntologyMessages} from '../i18n';

/** Stored product defaults shown in the page language while they are unchanged (a platform page name keeps its application name and translates only the default suffix); any other value is shown as saved. */
const defaultTextKeys=new Map<string,keyof OntologyMessages>([
  [productDefaultTexts.homeName,'productDefaultHomeName'],
  [productDefaultTexts.homeDescription,'productDefaultHomeDescription'],
  [productDefaultTexts.initialHomeName,'productHomeTitle'],
  [productDefaultTexts.apps,'productHomeResources'],
  [productDefaultTexts.data,'productHomeFollowedData'],
  [productDefaultTexts.tasks,'productSourceTasks'],
  [productDefaultTexts.conversations,'productDefaultContinueWork'],
  [productDefaultTexts.objects,'productDefaultFavorites'],
  [productDefaultTexts.recent,'productSourceRecent'],
  [productDefaultTexts.legacyAssistant,'productHomeAskHeading'],
  [productDefaultTexts.legacyAssistantDescription,'productHomeAskDescription'],
  [productDefaultTexts.legacyAssistantPlaceholder,'productHomeAskPlaceholder'],
  [productDefaultTexts.legacyConversations,'productHomeContinueAnalysis'],
  [productDefaultTexts.legacyObjects,'productDefaultPinnedObjects'],
  [productDefaultTexts.platformPageDescription,'productDefaultPlatformPageDescription'],
  [productDefaultTexts.graphDomainMembers,'productDomainMembers'],
  [productDefaultTexts.graphNameUnavailable,'productNameUnavailable'],
  [productDefaultTexts.graphAgentPrincipal,'productAgentPrincipal'],
  [productDefaultTexts.graphRoleUnavailable,'productRoleNameUnavailable'],
  [productDefaultTexts.graphPrincipalUnavailable,'productPrincipalNameUnavailable'],
  [productDefaultTexts.graphMetricUnavailable,'productMetricViewNameUnavailable'],
  [productDefaultTexts.graphActionUnavailable,'productActionNameUnavailable'],
  [productDefaultTexts.graphDefinitionUnavailable,'productDefinitionNameUnavailable'],
  [productDefaultTexts.graphObjectTypeUnavailable,'productObjectTypeNameUnavailable'],
  [productDefaultTexts.graphApplicationUnavailable,'productApplicationNameUnavailable'],
]);
const pageSuffix=productDefaultTexts.platformPageSuffix;
export function useProductText(){
  const {ot}=useOntologyText();
  return (value:string)=>{const key=defaultTextKeys.get(value);if(key)return ot(key);return value.endsWith(pageSuffix)?ot('productPageSuffix',{name:value.slice(0,-pageSuffix.length)}):value;};
}
