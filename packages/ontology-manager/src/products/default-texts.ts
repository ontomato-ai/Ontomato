import {productDefaultTexts} from '@ontomato/contracts/product-assets';
import {useOntologyText} from '../context';
import type {OntologyMessages} from '../i18n';

/** A value equal to a stored product default is shown in the page language; any other value is shown as saved. */
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
  [productDefaultTexts.graphAgentDefinition,'productAgentDefinition'],
  [productDefaultTexts.graphRoleUnavailable,'productRoleNameUnavailable'],
  [productDefaultTexts.graphPrincipalUnavailable,'productPrincipalNameUnavailable'],
  [productDefaultTexts.graphMetricUnavailable,'productMetricViewNameUnavailable'],
  [productDefaultTexts.graphActionUnavailable,'productActionNameUnavailable'],
  [productDefaultTexts.graphDefinitionUnavailable,'productDefinitionNameUnavailable'],
  [productDefaultTexts.graphObjectTypeUnavailable,'productObjectTypeNameUnavailable'],
  [productDefaultTexts.graphApplicationUnavailable,'productApplicationNameUnavailable'],
]);
export function useProductText(){
  const {ot}=useOntologyText();
  return (value:string)=>{const key=defaultTextKeys.get(value);return key?ot(key):value;};
}
