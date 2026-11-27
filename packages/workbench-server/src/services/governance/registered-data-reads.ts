import { panelFormDescriptionSchema } from "@ontomato/contracts/panel-projection";
import { PERMISSION_POLICY, ROLE, USER } from "@ontomato/contracts/platform-object-types";
import { requireFormFieldNames } from "../../utils/form-field-names";
import type { RegisteredDataReadContext, RegisteredDataReadRegistration } from "../product-panels/registered-data-read";
import { withPolicyFormEntryUsage } from "./panel-reads";
import { effectiveAccessNeedsWorkbenchCatalog, loadPolicyWorkbenchCatalog } from "./policy-catalog";

function withPrimaryKey(selection: RegisteredDataReadContext["selection"], parameters: Record<string, unknown>) {
  return { ...parameters, ...(selection.primaryKey !== undefined && { primaryKey: selection.primaryKey }) };
}

async function effectiveAccessCall({ selection, params, owner, credentials }: RegisteredDataReadContext) {
  const category = params.category as string | undefined;
  return {
    type: selection.typeId, name: selection.method,
    parameters: withPrimaryKey(selection, {
      ...(category && { category }),
      ...(effectiveAccessNeedsWorkbenchCatalog(category) && {
        workbenchCatalog: await loadPolicyWorkbenchCatalog(owner.domainId, credentials.locale),
      }),
    }),
  };
}

const validateGovernanceForm: NonNullable<RegisteredDataReadRegistration["validate"]> = ({ params }) => {
  requireFormFieldNames(params.values, "values");
};

export const governanceDataReadRegistrations: RegisteredDataReadRegistration[] = [
  { typeId: USER, method: "effectiveAccess", javaCall: effectiveAccessCall },
  { typeId: ROLE, method: "effectiveAccess", javaCall: effectiveAccessCall },
  ...(["form", "createForm"] as const).map(method => ({
    typeId: ROLE, method, validate: validateGovernanceForm,
  })),
  {
    typeId: PERMISSION_POLICY, method: "objectGrantCandidates",
    javaCall: async ({ selection, params, owner, credentials }) => ({
      type: PERMISSION_POLICY, name: "objectGrantCandidates",
      parameters: withPrimaryKey(selection, {
        ...params,
        workbenchCatalog: await loadPolicyWorkbenchCatalog(owner.domainId, credentials.locale),
      }),
    }),
  },
  {
    typeId: PERMISSION_POLICY, method: "form",
    validate: validateGovernanceForm,
    javaCall: async ({ selection, params, owner, credentials, cache }) => ({
      type: PERMISSION_POLICY, name: "form",
      parameters: withPrimaryKey(selection, {
        ...params,
        workbenchCatalog: await cache.read("permission-policy-form-workbench-catalog",
          () => loadPolicyWorkbenchCatalog(owner.domainId, credentials.locale)),
      }),
    }),
    present: (payload, { credentials, owner, selection }) => withPolicyFormEntryUsage(
      panelFormDescriptionSchema.parse(payload), credentials, owner.domainId, selection.primaryKey!,
    ),
  },
  { typeId: PERMISSION_POLICY, method: "createForm", validate: validateGovernanceForm },
];
