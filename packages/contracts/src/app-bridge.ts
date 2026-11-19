import {z} from 'zod';
import {panelConversationEntrySchema} from './panel-conversation-entry';
import {panelHumanOperationPreparationSchema} from './panel-agent';

export const APP_BRIDGE_CHANNEL='ontomato-app-v2';

/**
 * What an app frame reports about its page: `{page, selection}`, the shape every published app and every workspace
 * pinned to an older SDK version sends. It is a wire format, so it stays as it is; the shell completes it into the one
 * `PageContext` with the frame's own address, at that single boundary.
 */
export const appBridgePageContextSchema=z.object({page:z.string().trim().min(1).max(500),selection:z.object({className:z.string().min(1).max(200),primaryKey:z.string().min(1).max(1000),name:z.string().min(1).max(500)}).strict().nullable()}).strict();
export const appBridgeRequestSchema=z.object({channel:z.literal(APP_BRIDGE_CHANNEL),id:z.string().min(1).max(100),operation:z.enum(['initialize','request','cancel','navigate','navigateProduct','pageContext','authFailure','invalidate','mount','unmount','placement','expand-page-composer','confirm-panel-operation']),payload:z.unknown()}).strict();
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


/**
 * An explicit user action can expand the composer and fill the declared text; sending is a separate user action.
 * The host accepts the exact target and prefill of this instance's registered slot declaration.
 * The selection is limited to current page candidates. An unavailable target only expands the composer and
 * reveals no private information.
 * A current conversation keeps its existing agent.
 * Expanding for this action leaves the user's saved collapse preference alone.
 */
export const appBridgeExpandPageComposerSchema = panelConversationEntrySchema.extend({
  slot: z.string().min(1).max(200),
});
export type AppBridgeExpandPageComposer = z.infer<typeof appBridgeExpandPageComposerSchema>;

/** The host rereads the authenticated Node preparation by intentId before showing the confirmation. */
export const appBridgeConfirmPanelOperationSchema = panelHumanOperationPreparationSchema;
export type AppBridgeConfirmPanelOperation = z.infer<typeof appBridgeConfirmPanelOperationSchema>;

/** Human confirmation applies to the same inspected calls. Cancel ends the invocation before any write. */
export const appBridgeConfirmPanelOperationResultSchema = z.object({
  decision: z.enum(['confirm', 'cancel']),
}).strict();
export type AppBridgeConfirmPanelOperationResult = z.infer<typeof appBridgeConfirmPanelOperationResultSchema>;
