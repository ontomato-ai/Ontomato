import fixedProductAccess from "./fixed-product-access.json" with { type: "json" };

/** The release allows this verb on records proven by the product owner to be built in. */
export function fixedProductAllows(kind: string, verb: string): boolean {
  return Object.hasOwn(fixedProductAccess, kind) && fixedProductAccess[kind as keyof typeof fixedProductAccess] === verb;
}
