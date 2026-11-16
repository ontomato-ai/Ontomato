import {z} from 'zod';

const id=z.string().min(1).max(200);
export const productSubscriptionTargetSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('definition'),id,parameters:z.record(z.unknown()),fields:z.array(id).min(1).max(100)}).strict(),
  z.object({kind:z.literal('trigger'),id,parameters:z.record(z.unknown())}).strict(),
]);
export const definitionTriggerSchema=z.object({id,name:id,definitionId:id,revision:z.number().int().positive(),status:z.enum(['DRAFT','PUBLISHED']),event:z.enum(['entered','left','changed']),keyField:id}).strict();
export type ProductSubscriptionTarget=z.infer<typeof productSubscriptionTargetSchema>;
export interface ProductSubscriptionEvent {kind:'changed'|'entered'|'left';targetId:string;revision:string;observedAt:string;memberKeys?:string[]}
