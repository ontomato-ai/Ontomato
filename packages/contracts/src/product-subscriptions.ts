import {z} from 'zod';
import {productDefinitionChangedEventSchema,type ProductDefinitionChangedEvent} from './product-panels';
import {pageSkillContextSchema} from './page-skills';

const id=z.string().min(1).max(200);
export const productSubscriptionTargetSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('definition'),id,parameters:z.record(z.unknown()),fields:z.array(id).min(1).max(100)}).strict(),
  z.object({kind:z.literal('trigger'),id,parameters:z.record(z.unknown())}).strict(),
  z.object({kind:z.literal('product-definition'),target:productDefinitionChangedEventSchema.shape.target.extend({kind:z.literal('projection')})}).strict(),
]);
export const definitionTriggerSchema=z.object({id,name:id,definitionId:id,revision:z.number().int().positive(),status:z.enum(['DRAFT','PUBLISHED']),event:z.enum(['entered','left','changed']),keyField:id}).strict();
export type ProductSubscriptionTarget=z.infer<typeof productSubscriptionTargetSchema>;
export type ProductSubscriptionEvent = ProductDefinitionChangedEvent | {kind:'changed'|'entered'|'left';targetId:string;revision:string;observedAt:string;memberKeys?:string[]};


export const definitionRevisionSchema = z.object({id,revision:z.number().int().positive()}).strict();
export type DefinitionRevision = z.infer<typeof definitionRevisionSchema>;
export const panelDefinitionSnapshotSchema = z.object({
  panel:definitionRevisionSchema,
  projections:z.array(definitionRevisionSchema),
  pageSkillContext:pageSkillContextSchema.optional(),
}).strict();
export type PanelDefinitionSnapshot = z.infer<typeof panelDefinitionSnapshotSchema>;

const productDefinitionTargetSchema = productDefinitionChangedEventSchema.shape.target;
export type ProductDefinitionTarget = z.infer<typeof productDefinitionTargetSchema>;
const productDefinitionRevisionSchema = productDefinitionTargetSchema.extend({revision:definitionRevisionSchema.shape.revision});
export type ProductDefinitionRevision = z.infer<typeof productDefinitionRevisionSchema>;
export const productDefinitionStreamRequestSchema = z.object({
  targets:z.array(productDefinitionTargetSchema).min(1),
}).strict();
export const productDefinitionStreamFrameSchema = z.discriminatedUnion('kind', [
  z.object({kind:z.literal('snapshot'),definitions:z.array(productDefinitionRevisionSchema)}).strict(),
  z.object({kind:z.literal('definition-changed'),definition:productDefinitionRevisionSchema}).strict(),
]);
export type ProductDefinitionStreamFrame = z.infer<typeof productDefinitionStreamFrameSchema>;
