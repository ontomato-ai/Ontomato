import { panelFormDescriptionSchema } from "@ontomato/contracts/panel-projection";
import { PERMISSION_POLICY, ROLE, USER } from "@ontomato/contracts/platform-object-types";
import { requireFormFieldNames } from "../../utils/form-field-names";
import { defaultReadRegistration, readyPayload, renderReadPayload, type RegisteredDataReadContext, type RegisteredDataReadRegistration, type RegisteredJavaCall } from "../product-panels/registered-data-read";
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


const validateGovernanceForm = ({ params }: RegisteredDataReadContext) => {
  requireFormFieldNames(params.values, "values");
};

function customJavaRead(
  typeId: string, method: string,
  call: (context: RegisteredDataReadContext) => Promise<RegisteredJavaCall>,
): RegisteredDataReadRegistration {
  return {
    typeId, method,
    plan: async context => ({
      reads: [{ call: await call(context) }],
      present: results => readyPayload(results[0]).payload,
    }),
  };
}

export const governanceDataReadRegistrations: RegisteredDataReadRegistration[] = [
  customJavaRead(USER, "effectiveAccess", effectiveAccessCall),
  customJavaRead(ROLE, "effectiveAccess", effectiveAccessCall),
  ...(["form", "createForm"] as const).map(method =>
    defaultReadRegistration(ROLE, method, undefined, validateGovernanceForm)),
  customJavaRead(PERMISSION_POLICY, "objectGrantCandidates", async ({ selection, params, owner, credentials }) => ({
    type: PERMISSION_POLICY, name: "objectGrantCandidates",
    parameters: withPrimaryKey(selection, {
      ...params,
      workbenchCatalog: await loadPolicyWorkbenchCatalog(owner.domainId, credentials.locale),
    }),
  })),
  {
    typeId: PERMISSION_POLICY, method: "form",
    plan: async context => {
      validateGovernanceForm(context);
      const { selection, params, owner, credentials, cache } = context;
      return {
        reads: [{
          call: {
            type: PERMISSION_POLICY, name: "form",
            parameters: withPrimaryKey(selection, {
              ...params,
              workbenchCatalog: await cache.read("permission-policy-form-workbench-catalog",
                () => loadPolicyWorkbenchCatalog(owner.domainId, credentials.locale)),
            }),
          },
        }],
        present: results => renderReadPayload(readyPayload(results[0]).payload,
          value => withPolicyFormEntryUsage(panelFormDescriptionSchema.parse(value), credentials, owner.domainId, selection.primaryKey!)),
      };
    },
  },
  defaultReadRegistration(PERMISSION_POLICY, "createForm", undefined, validateGovernanceForm),
];
