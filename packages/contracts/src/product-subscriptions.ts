import {z} from 'zod';
import {productDefinitionChangedEventSchema} from './product-panels';
import {panelMemberPathSchema} from './panel-manifest';

const id=z.string().min(1).max(200);
export const definitionTriggerSchema=z.object({id,name:id,definitionId:id,revision:z.number().int().positive(),status:z.enum(['DRAFT','PUBLISHED']),event:z.enum(['entered','left','changed']),keyField:id}).strict();

export const definitionRevisionSchema = z.object({id,revision:z.number().int().positive()}).strict();
export type DefinitionRevision = z.infer<typeof definitionRevisionSchema>;
export const panelMemberSnapshotSchema = z.discriminatedUnion('status',[
  z.object({
    status:z.literal('ready'), memberPath:panelMemberPathSchema.nonempty(),
    target:productDefinitionChangedEventSchema.shape.target, revision:definitionRevisionSchema.shape.revision,
  }).strict(),
  z.object({status:z.literal('forbidden'), memberPath:panelMemberPathSchema.nonempty()}).strict(),
]);
export type PanelMemberSnapshot = z.infer<typeof panelMemberSnapshotSchema>;
export const panelDefinitionSnapshotSchema = z.object({
  panel:definitionRevisionSchema,
  projections:z.array(definitionRevisionSchema),
  members:z.array(panelMemberSnapshotSchema).optional(),
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
