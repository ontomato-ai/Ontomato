import { z } from "zod";
import { agentDefinitionTypeDetail } from "./platform-type-details/agent-definition";
import { applicationTypeDetail } from "./platform-type-details/application";
import { productPanelTypeDetail } from "./platform-type-details/product-panel";
import { productProjectionTypeDetail } from "./platform-type-details/product-projection";
import { sdkComponentTypeDetail } from "./platform-type-details/sdk-component";

/** One documented field of a type's public record. */
export const platformTypePropertySchema = z.object({
  name: z.string().min(1).max(120),
  type: z.string().min(1).max(120),
  optional: z.boolean().optional(),
  description: z.string().min(1).max(400),
}).strict();
export type PlatformTypeProperty = z.infer<typeof platformTypePropertySchema>;

/** Each owner describes its public record and authority here, independently of the read and operation signatures. */
export const platformTypeDetailDeclarationSchema = z.object({
  id: z.string().min(1).max(120),
  definition: z.string().min(1).max(400),
  properties: z.array(platformTypePropertySchema).min(1),
  rules: z.string().min(1).max(800),
}).strict();
export type PlatformTypeDetailDeclaration = z.infer<typeof platformTypeDetailDeclarationSchema>;

export const platformTypeDetails: Readonly<Partial<Record<string, PlatformTypeDetailDeclaration>>> = {
  [agentDefinitionTypeDetail.id]: agentDefinitionTypeDetail,
  [applicationTypeDetail.id]: applicationTypeDetail,
  [productPanelTypeDetail.id]: productPanelTypeDetail,
  [productProjectionTypeDetail.id]: productProjectionTypeDetail,
  [sdkComponentTypeDetail.id]: sdkComponentTypeDetail,
};
