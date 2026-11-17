import {z} from 'zod';

import {pageContextSchema} from './page-context';

export const APP_BRIDGE_CHANNEL='ontomato-app-v2';
export const appBridgeRequestSchema=z.object({channel:z.literal(APP_BRIDGE_CHANNEL),id:z.string().min(1).max(100),operation:z.enum(['initialize','request','cancel','navigate','navigateProduct','pageContext','authFailure','invalidate','mount','unmount','placement']),payload:z.unknown()}).strict();
export const appBridgeCancelSchema=z.object({requestId:z.string().min(1).max(100)}).strict();
export type AppBridgeRequest=z.infer<typeof appBridgeRequestSchema>;
export interface AppBridgeResponse {channel:typeof APP_BRIDGE_CHANNEL;id:string;result?:unknown;error?:string}
export const appBridgeHttpSchema=z.object({path:z.string().max(4000),service:z.string(),method:z.enum(['GET','POST','PUT','DELETE']),headers:z.array(z.tuple([z.string(),z.string()])),body:z.unknown()}).strict();
export const appBridgeMountSchema=z.object({id:z.string().uuid(),assetId:z.string().min(1).max(200)}).strict();
export const appBridgePlacementSchema=z.object({id:z.string().uuid(),x:z.number().finite(),y:z.number().finite(),width:z.number().finite().nonnegative(),height:z.number().finite().nonnegative(),visible:z.boolean()}).strict();
export const appBridgeUnmountSchema=z.object({id:z.string().uuid()}).strict();
export const appBridgePathSchema=z.string().max(2000);
export const appBridgeAuthStatusSchema=z.union([z.literal(401),z.literal(402)]);
export const appBridgeInvalidationSchema=z.object({actionId:z.string(),objectTypes:z.array(z.string())}).strict();
export const appBridgePageContextSchema=pageContextSchema;
