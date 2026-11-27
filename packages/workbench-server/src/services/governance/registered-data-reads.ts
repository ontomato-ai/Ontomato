import { panelFormDescriptionSchema } from "@ontomato/contracts/panel-projection";
import {
  DELETE_ORG_POSITION, DELETE_PERMISSION_POLICY, DELETE_ROLE, GENERATE_USER_API_KEY, ORG_UNIT, PERMISSION_POLICY,
  REGENERATE_USER_API_KEY, REMOVE_ORG_MEMBERSHIP, REMOVE_USER, REVOKE_USER_API_KEY, ROLE, USER,
} from "@ontomato/contracts/platform-object-types";
import { z } from "zod";
import { HttpError } from "../../utils/errors";
import { requireFormFieldNames } from "../../utils/form-field-names";
import {
  defaultReadRegistration, defaultRegisteredJavaCall, readyPayload, renderReadPayload, type RegisteredDataReadContext,
  type RegisteredDataReadRegistration, type RegisteredJavaCall,
} from "../product-panels/registered-data-read";
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

const refusalSchema = z.string().min(1).max(500).nullable();

/** A refusal the list owner carried back for one row, the same `{ reason }` the operation's own refusal read gives. */
function carriedRefusal(reason: string | null | undefined, operation: string, primaryKey: string) {
  if (reason === undefined)
    throw new HttpError(502, `The list owner did not carry '${operation}' facts for '${primaryKey}'`, "PANEL_READ_OWNER_RESPONSE_INVALID");
  return { reason };
}

/** A governance list that carries each row's removal refusal when asked with `inspectRowRemoval`. */
function removalCarryingList(typeId: string, method: string, removal: string): RegisteredDataReadRegistration {
  const carried = z.object({ value: z.unknown(), rowRefusals: z.record(refusalSchema) });
  return {
    typeId, method, carries: [removal],
    plan(context) {
      const call = defaultRegisteredJavaCall(context);
      if (!context.rowOperations.includes(removal))
        return { reads: [{ call }], present: results => readyPayload(results[0]).payload };
      return {
        reads: [{ call: { ...call, parameters: { ...call.parameters, inspectRowRemoval: true } } }],
        present: results => carried.parse(readyPayload(results[0]).payload).value,
        rowFacts(results) {
          const { rowRefusals } = carried.parse(readyPayload(results[0]).payload);
          return (operation, { primaryKey }) => carriedRefusal(rowRefusals[primaryKey], operation, primaryKey);
        },
      };
    },
  };
}

/** The member owner's refusal field of each operation the member list carries for its rows. */
const memberRefusalFields: Readonly<Record<string, string>> = {
  [REMOVE_USER]: "remove",
  [GENERATE_USER_API_KEY]: "generateApiKey",
  [REGENERATE_USER_API_KEY]: "regenerateApiKey",
  [REVOKE_USER_API_KEY]: "revokeApiKey",
};
const memberQuerySchema = z.object({ query: z.unknown(), rowRefusals: z.record(z.record(refusalSchema)) });

/** The member list carries each row's member operation refusals; the API key ones only when asked with `inspectApiKeyRows`. */
const memberQueryRegistration: RegisteredDataReadRegistration = {
  typeId: USER, method: "query", carries: Object.keys(memberRefusalFields),
  plan(context) {
    const call = defaultRegisteredJavaCall(context);
    const inspectApiKeyRows = context.rowOperations.some(operation => operation !== REMOVE_USER);
    return {
      reads: [{ call: inspectApiKeyRows ? { ...call, parameters: { ...call.parameters, inspectApiKeyRows } } : call }],
      present: results => memberQuerySchema.parse(readyPayload(results[0]).payload).query,
      rowFacts(results) {
        const { rowRefusals } = memberQuerySchema.parse(readyPayload(results[0]).payload);
        return (operation, { primaryKey }) =>
          carriedRefusal(rowRefusals[primaryKey]?.[memberRefusalFields[operation]!], operation, primaryKey);
      },
    };
  },
};

export const governanceDataReadRegistrations: RegisteredDataReadRegistration[] = [
  removalCarryingList(ROLE, "query", DELETE_ROLE),
  removalCarryingList(PERMISSION_POLICY, "query", DELETE_PERMISSION_POLICY),
  removalCarryingList(ORG_UNIT, "members", REMOVE_ORG_MEMBERSHIP),
  removalCarryingList(ORG_UNIT, "positions", DELETE_ORG_POSITION),
  memberQueryRegistration,
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
