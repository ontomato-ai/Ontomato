import operations from "./workbench-management-operations.json" with { type: "json" };

export const workbenchManagement = operations;
export type WorkbenchManagementOperation = (typeof workbenchManagement)[keyof typeof workbenchManagement];
