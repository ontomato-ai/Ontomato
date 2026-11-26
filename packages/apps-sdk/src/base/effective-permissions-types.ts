export interface EffectivePermissionOrgRoleGrant {
  readonly role: string;
  readonly recipient?: string;
}

export interface EffectivePermissionShareRoleRule {
  readonly className: string;
  readonly rule: string;
}

export interface EffectivePermissionShareRole {
  readonly roleName: string;
  readonly contributors?: string | number;
  readonly fullRowClasses?: readonly string[];
  readonly rowRules?: readonly EffectivePermissionShareRoleRule[];
  readonly summary?: string;
}

export interface EffectivePermissionOrgShareItem {
  readonly key: string;
  readonly scope: string;
  readonly recipient?: string;
  readonly shareBase?: string;
  readonly coveredOrganizations: readonly string[];
  readonly coveredUsers?: number;
  readonly roles: readonly EffectivePermissionShareRole[];
}

export interface EffectiveManagementOperationItem {
  key: string;
  label: string;
  access?: string;
  operationId?: string;
}

export interface EffectivePermissionDataRow {
  readonly key: string;
  readonly className: string;
  readonly classLabel: string;
  readonly fullRows: boolean;
  readonly fullColumns: boolean;
  readonly rowRules: readonly string[];
  readonly visibleFields: readonly string[];
  readonly groupableColumns: readonly string[];
}
