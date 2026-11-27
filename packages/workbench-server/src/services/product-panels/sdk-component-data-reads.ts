import { SDK_COMPONENT } from "@ontomato/contracts/platform-object-types";
import type { AssistantCredentials } from "../../utils/assistant-credentials";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "../product-governance/service-authentication";
import type { DefinitionVisibilityRange } from "./access";
import {
  countSdkComponentsInRange, listSdkComponents, readSdkComponent, readSdkComponentConfigRows, readSdkComponentDataRows,
  readSdkComponentInputRows, readSdkComponentOperationRows, readSdkComponentOutputRows, readSdkComponentRecord,
} from "./component-catalogue";
import { localReadRegistration, type RegisteredDataReadRegistration, type RegisteredLocalDataRead } from "./registered-data-read";
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
  localReadRegistration(SDK_COMPONENT, "count",
    {
      visibility: [{ kind: "COMPONENT", verbs: ["USE"] }],
      read: (owner, ranges) => countSdkComponentsInRange(owner.domainId, ranges!.COMPONENT.USE),
    }),
  localReadRegistration(SDK_COMPONENT, "catalogue",
    sdkComponentUseRegisteredRead((owner, _key, credentials, range, params) =>
      listSdkComponents(owner, credentials, params.search as string | undefined, range))),
  localReadRegistration(SDK_COMPONENT, "definition", sdkComponentUseRegisteredRead(readSdkComponent)),
  localReadRegistration(SDK_COMPONENT, "record", sdkComponentUseRegisteredRead(readSdkComponentRecord)),
  localReadRegistration(SDK_COMPONENT, "dataRows", sdkComponentUseRegisteredRead(readSdkComponentDataRows)),
  localReadRegistration(SDK_COMPONENT, "configRows", sdkComponentUseRegisteredRead(readSdkComponentConfigRows)),
  localReadRegistration(SDK_COMPONENT, "inputRows", sdkComponentUseRegisteredRead(readSdkComponentInputRows)),
  localReadRegistration(SDK_COMPONENT, "outputRows", sdkComponentUseRegisteredRead(readSdkComponentOutputRows)),
  localReadRegistration(SDK_COMPONENT, "operationRows", sdkComponentUseRegisteredRead(readSdkComponentOperationRows)),
];
