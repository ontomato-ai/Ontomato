import { qualifiedTable as t } from "../../postgres";
import type { QueryableClient } from "../helpers";
import {normalizeComposition} from '../../../utils/product-composition';
import {productAssetInputSchema} from '@ontomato/contracts/product-assets';

export async function ensureProductAssetsSchema(client: QueryableClient) {
  await client.query(`CREATE TABLE IF NOT EXISTS ${t("product_assets")} (
    domain_id text NOT NULL, id text NOT NULL, owner_id text NOT NULL,
    name text NOT NULL, description text NOT NULL DEFAULT '', visibility text NOT NULL DEFAULT 'private',
    document jsonb NOT NULL, revision integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(domain_id,id));
    CREATE INDEX IF NOT EXISTS product_assets_owner ON ${t("product_assets")}(domain_id,owner_id);
    CREATE TABLE IF NOT EXISTS ${t("product_home")} (
    domain_id text NOT NULL, user_id text NOT NULL, asset_id text NOT NULL,
    PRIMARY KEY(domain_id,user_id));`);
  await client.query(`ALTER TABLE ${t('product_assets')} ADD COLUMN IF NOT EXISTS governance_registered boolean NOT NULL DEFAULT false`);
  await client.query(`CREATE TABLE IF NOT EXISTS ${t('product_ontology_outbox')} (domain_id text NOT NULL,asset_id text NOT NULL,revision bigint NOT NULL,registration jsonb,PRIMARY KEY(domain_id,asset_id));
    CREATE TABLE IF NOT EXISTS ${t('product_object_view_heads')} (domain_id text NOT NULL,asset_id text NOT NULL,revision integer NOT NULL,PRIMARY KEY(domain_id,asset_id));
    CREATE TABLE IF NOT EXISTS ${t('product_publication_outbox')} (domain_id text NOT NULL,bundle_id text NOT NULL,release_id text NOT NULL,PRIMARY KEY(domain_id,bundle_id));
    CREATE TABLE IF NOT EXISTS ${t('product_subscriptions')} (domain_id text NOT NULL,principal_id text NOT NULL,id text NOT NULL,target jsonb NOT NULL,expires_at timestamptz NOT NULL,state jsonb NOT NULL,PRIMARY KEY(domain_id,principal_id,id));
    ALTER TABLE ${t('product_assets')} ADD COLUMN IF NOT EXISTS ontology_registered_revision bigint NOT NULL DEFAULT 0`);
  // Preserve IDs and parent references while correcting legacy display-only panels.
  await client.query(`CREATE TABLE IF NOT EXISTS ${t('product_asset_revisions')} (domain_id text NOT NULL,asset_id text NOT NULL,revision integer NOT NULL,asset jsonb NOT NULL,PRIMARY KEY(domain_id,asset_id,revision));
    CREATE TABLE IF NOT EXISTS ${t('product_profile_sessions')} (domain_id text NOT NULL,session_id text NOT NULL,profile_id text NOT NULL,release_id text NOT NULL,PRIMARY KEY(domain_id,session_id));
    ALTER TABLE ${t('product_profile_sessions')} ADD COLUMN IF NOT EXISTS context_objects jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE ${t('product_profile_sessions')} ADD COLUMN IF NOT EXISTS page_state jsonb NOT NULL DEFAULT '{}'::jsonb;
    CREATE TABLE IF NOT EXISTS ${t('definition_triggers')} (domain_id text NOT NULL,id text NOT NULL,status text NOT NULL,definition jsonb NOT NULL,PRIMARY KEY(domain_id,id));
    CREATE TABLE IF NOT EXISTS ${t('product_bundle_heads')} (domain_id text NOT NULL,bundle_id text NOT NULL,release_id text NOT NULL,PRIMARY KEY(domain_id,bundle_id));
    CREATE TABLE IF NOT EXISTS ${t('business_definitions')} (domain_id text NOT NULL,id text NOT NULL,status text NOT NULL,definition jsonb NOT NULL,PRIMARY KEY(domain_id,id));
    CREATE TABLE IF NOT EXISTS ${t('product_user_overlays')} (domain_id text NOT NULL,principal_id text NOT NULL,page_id text NOT NULL,revision integer NOT NULL DEFAULT 1,preferences jsonb NOT NULL,PRIMARY KEY(domain_id,principal_id,page_id));
    CREATE TABLE IF NOT EXISTS ${t('product_releases')} (domain_id text NOT NULL,release_id text NOT NULL,application_id text NOT NULL,owner_id text NOT NULL,snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(domain_id,release_id));
    INSERT INTO ${t('product_asset_revisions')} (domain_id,asset_id,revision,asset) SELECT domain_id,id,revision,jsonb_build_object('id',id,'ownerId',owner_id,'name',name,'description',description,'visibility',visibility,'document',document,'revision',revision,'createdAt',created_at,'updatedAt',updated_at,'editable',false) FROM ${t('product_assets')} ON CONFLICT DO NOTHING;`);
  await client.query(`UPDATE ${t("product_assets")} SET document=jsonb_set(document,'{kind}','"widget-group"'::jsonb),revision=revision+1,updated_at=now()
    WHERE document->>'kind'='operation-panel' AND jsonb_array_length(document->'widgets')>0
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(document->'widgets') widget WHERE widget->>'kind' NOT IN ('text','metric','table','chart'))`);
  // Platform interactions are component instances, not a separate asset category.
  await client.query(`UPDATE ${t('product_assets')} asset SET document=jsonb_build_object('kind','widget','widget',jsonb_strip_nulls(jsonb_build_object(
    'kind','platform','source',asset.document->>'section','placeholder',COALESCE(asset.document->>'placeholder',''),'limit',COALESCE((asset.document->>'limit')::int,4),
    'workspace',(SELECT page.document->'workspace' FROM ${t('product_assets')} page WHERE page.domain_id=asset.domain_id AND page.owner_id=asset.owner_id AND page.document->>'kind'='page' AND EXISTS(SELECT 1 FROM jsonb_array_elements(page.document->'children') child WHERE child->>'assetId'=asset.id) ORDER BY page.updated_at DESC LIMIT 1)))),revision=revision+1,updated_at=now()
    WHERE asset.document->>'kind'='workspace-block'`);
  const legacy=await client.query(`SELECT domain_id,id,owner_id,name,description,visibility,document FROM ${t('product_assets')} WHERE document->>'kind' IN ('widget-group','operation-panel','layout-template')`);
  for(const row of legacy.rows){
    const normalized=normalizeComposition(row.id,productAssetInputSchema.parse({name:row.name,description:row.description,visibility:row.visibility,document:row.document}));
    for(const child of normalized.children)await client.query(`INSERT INTO ${t('product_assets')} (domain_id,id,owner_id,name,description,visibility,document) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT DO NOTHING`,[row.domain_id,child.id,row.owner_id,child.input.name,child.input.description,child.input.visibility,JSON.stringify(child.input.document)]);
    await client.query(`UPDATE ${t('product_assets')} SET document=$3::jsonb,revision=revision+1,updated_at=now() WHERE domain_id=$1 AND id=$2`,[row.domain_id,row.id,JSON.stringify(normalized.input.document)]);
  }
  const projections=await client.query(`SELECT domain_id,id,name,description,visibility,document FROM ${t('product_assets')} WHERE document->>'kind'='widget' AND document->'widget'->>'kind' IN ('metric','table','chart','action')`);
  for(const row of projections.rows){
    const normalized=normalizeComposition(row.id,productAssetInputSchema.parse({name:row.name,description:row.description,visibility:row.visibility,document:row.document}));
    await client.query(`UPDATE ${t('product_assets')} SET document=$3::jsonb,revision=revision+1,updated_at=now() WHERE domain_id=$1 AND id=$2`,[row.domain_id,row.id,JSON.stringify(normalized.input.document)]);
  }
  const migrated=await client.query(`SELECT p.domain_id,p.id,p.document,r.asset FROM ${t('product_assets')} p JOIN LATERAL (SELECT asset FROM ${t('product_asset_revisions')} WHERE domain_id=p.domain_id AND asset_id=p.id AND asset->'document'->>'kind' IN ('widget-group','operation-panel') ORDER BY revision DESC LIMIT 1) r ON true WHERE p.document->>'kind'='page' AND EXISTS(SELECT 1 FROM jsonb_array_elements(p.document->'children') child WHERE NOT child ? 'width')`);
  for(const row of migrated.rows){
    const source=row.asset;
    const normalized=normalizeComposition(row.id,productAssetInputSchema.parse({name:source.name,description:source.description,visibility:source.visibility,document:source.document}));
    if(!('children' in normalized.input.document))continue;
    const widths=new Map(normalized.input.document.children.map(child=>[child.assetId,child.width]));
    const children=row.document.children.map((child:{assetId:string;width?:number})=>widths.has(child.assetId)&&child.width===undefined?{...child,width:widths.get(child.assetId)}:child);
    if(JSON.stringify(children)!==JSON.stringify(row.document.children))await client.query(`UPDATE ${t('product_assets')} SET document=jsonb_set(document,'{children}',$3::jsonb),revision=revision+1,updated_at=now() WHERE domain_id=$1 AND id=$2`,[row.domain_id,row.id,JSON.stringify(children)]);
  }
  await client.query(`INSERT INTO ${t('product_user_overlays')} (domain_id,principal_id,page_id,preferences)
    SELECT domain_id,owner_id,id,document->'workspace' FROM ${t('product_assets')} WHERE document->>'kind'='page' AND document ? 'workspace' ON CONFLICT DO NOTHING;
    UPDATE ${t('product_assets')} SET document=document-'workspace',revision=revision+1,updated_at=now() WHERE document->>'kind'='page' AND document ? 'workspace'`);
  await client.query(`INSERT INTO ${t('product_asset_revisions')} (domain_id,asset_id,revision,asset) SELECT domain_id,id,revision,jsonb_build_object('id',id,'ownerId',owner_id,'name',name,'description',description,'visibility',visibility,'document',document,'revision',revision,'createdAt',created_at,'updatedAt',updated_at,'editable',false) FROM ${t('product_assets')} ON CONFLICT DO NOTHING`);
  await client.query(`INSERT INTO ${t('product_ontology_outbox')} (domain_id,asset_id,revision,registration)
    SELECT domain_id,id,revision,jsonb_build_object('id',id,'kind',document->>'kind','name',name,'revision',revision,'targetKind',CASE WHEN document ? 'renders' THEN document->'renders'->>'kind' WHEN document->>'kind'='agent-profile' THEN 'AgentPrincipal' END,'targetId',CASE WHEN document ? 'renders' THEN document->'renders'->>'id' WHEN document->>'kind'='agent-profile' THEN document->>'principalId' END,'isDefault',COALESCE((document->>'isDefault')::boolean,false))
    FROM ${t('product_assets')} WHERE (document ? 'renders' OR document->>'kind' IN ('application','agent-profile')) AND ontology_registered_revision<revision ON CONFLICT(domain_id,asset_id) DO NOTHING`);
  await client.query(`DROP TABLE IF EXISTS ${t('product_projection_edges')}`);
}
