import { SDK_COMPONENT } from "@ontomato/contracts/platform-object-types";
import type { AssistantCredentials } from "../../utils/assistant-credentials";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "../product-governance/service-authentication";
import type { DefinitionVisibilityRange } from "./access";
import {
  countSdkComponentsInRange, listSdkComponents, readSdkComponent, readSdkComponentConfigRows, readSdkComponentDataRows,
  readSdkComponentInputRows, readSdkComponentOperationRows, readSdkComponentOutputRows, readSdkComponentRecord,
} from "./component-catalogue";
import type { RegisteredDataReadRegistration, RegisteredLocalDataRead } from "./registered-data-read";
function sdkComponentUseRegisteredRead(
  read: (owner: ProductOwner, primaryKey: string, credentials: AssistantCredentials, range: DefinitionVisibilityRange,
    params: Record<string, unknown>) => Promise<unknown>,
): RegisteredLocalDataRead {
  return {
    visibility: [{ kind: "COMPONENT", verbs: ["USE"] }],
    read(owner, ranges, _facts, credentials, primaryKey, params) {
      const range = ranges?.COMPONENT?.USE;
      if (!range) throw new HttpError(502, "The panel read owner did not provide COMPONENT/USE visibility", "PANEL_READ_OWNER_RESPONSE_INVALID");
      return read(owner, primaryKey!, credentials, range, params);
    },
  };
}

export const sdkComponentDataReadRegistrations: RegisteredDataReadRegistration[] = [
  {
    typeId: SDK_COMPONENT, method: "count",
    local: {
      visibility: [{ kind: "COMPONENT", verbs: ["USE"] }],
      read: (owner, ranges) => countSdkComponentsInRange(owner.domainId, ranges!.COMPONENT.USE),
    },
  },
  {
    typeId: SDK_COMPONENT, method: "catalogue",
    local: sdkComponentUseRegisteredRead((owner, _key, credentials, range, params) =>
      listSdkComponents(owner, credentials, params.search as string | undefined, range)),
  },
  { typeId: SDK_COMPONENT, method: "definition", local: sdkComponentUseRegisteredRead(readSdkComponent) },
  { typeId: SDK_COMPONENT, method: "record", local: sdkComponentUseRegisteredRead(readSdkComponentRecord) },
  { typeId: SDK_COMPONENT, method: "dataRows", local: sdkComponentUseRegisteredRead(readSdkComponentDataRows) },
  { typeId: SDK_COMPONENT, method: "configRows", local: sdkComponentUseRegisteredRead(readSdkComponentConfigRows) },
  { typeId: SDK_COMPONENT, method: "inputRows", local: sdkComponentUseRegisteredRead(readSdkComponentInputRows) },
  { typeId: SDK_COMPONENT, method: "outputRows", local: sdkComponentUseRegisteredRead(readSdkComponentOutputRows) },
  { typeId: SDK_COMPONENT, method: "operationRows", local: sdkComponentUseRegisteredRead(readSdkComponentOperationRows) },
];
