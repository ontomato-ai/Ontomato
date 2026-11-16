import {productTypes} from '@ontomato/contracts/product-assets';
import {productCategories} from '@ontomato/contracts/product-graph';
import type {OntologyMessages} from '../i18n';
const typeKeys={
  'object-projection':['productObjectView','productObjectViewDescription','ObjectView'],
  'collection-view':['productCollectionView','productCollectionViewDescription','CollectionView'],
  'metric-widget':['productMetricWidget','productMetricWidgetDescription','MetricWidget'],
  'action-view':['productActionView','productActionViewDescription','ActionView'],
  page:['productPage','productPageDescription','Page'],
  navigation:['productNavigation','productNavigationDescription','Navigation'],
  application:['productApplication','productApplicationDescription','Application'],
  'agent-profile':['productAgentProfile','productAgentDescription','AgentProfile'],
} as const;
type Translate=(key:keyof OntologyMessages)=>string;
export function localizedProductTypes(ot:Translate){return productTypes.map(type=>{const [name,description]=typeKeys[type.kind];return {...type,name:ot(name),description:ot(description)};}).sort((a,b)=>productCategories.findIndex(category=>category.id===a.category)-productCategories.findIndex(category=>category.id===b.category));}
export function localizedProductCategories(ot:Translate){return productCategories.map(category=>{const keys={element:['productProjection','productProjectionDescription'],composition:['productComposition','productCompositionDescription'],bundle:['productBundle','productBundleDescription']} as const;const [name,description]=keys[category.id];return {...category,name:ot(name),description:ot(description)};});}
