export interface InstanceNameAttribute {
  name: string;
  enable?: boolean;
  businessKey?: boolean;
  bizzkeyBool?: boolean;
  bizzkey?: boolean;
  bizzKey?: boolean;
}

/** Names come from enabled business keys; primary keys are only used for addressing. */
export function businessNameAttribute(attributes: readonly InstanceNameAttribute[]) {
  const keys = attributes.filter(attr => attr.enable !== false && (attr.businessKey || attr.bizzkeyBool || attr.bizzkey || attr.bizzKey));
  return keys.find(attr => /^(?:.*_)?(?:name|title)$/.test(attr.name)) || keys[0];
}

export function instanceName(attributes: readonly InstanceNameAttribute[], row: Record<string, unknown>): string {
  const attribute = businessNameAttribute(attributes);
  const value = attribute ? row[attribute.name] : undefined;
  return value == null || String(value).trim() === "" ? "—" : String(value);
}
