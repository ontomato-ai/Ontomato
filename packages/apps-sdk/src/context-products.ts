import type { ManagerRequest } from "@ontomato/ontology-manager/clients";
import type { createProductsClient } from "./product-client";

export type ContextProducts = ReturnType<typeof createProductsClient>;

/** Keep the SDK's async methods available before the product-asset client is needed. */
export function contextProducts(transport: ManagerRequest): ContextProducts {
  let client: Promise<ContextProducts> | undefined;
  const load = () => client ??= import("./product-client").then(module => module.createProductsClient(transport));
  function method<Args extends unknown[], Result>(select: (products: ContextProducts) => (...args: Args) => Promise<Result>) {
    return async (...args: Args) => select(await load())(...args);
  }

  return {
    synchronizePlatform: method(products => products.synchronizePlatform),
    nativeBinding: method(products => products.nativeBinding),
    graph: method(products => products.graph),
    defaultProjectionWarnings: method(products => products.defaultProjectionWarnings),
    projections: method(products => products.projections),
    agentContext: method(products => products.agentContext),
    sourceTypes: method(products => products.sourceTypes),
    object: method(products => products.object),
    grants: method(products => products.grants),
    changeGrant: method(products => products.changeGrant),
    changeDomainGrant: method(products => products.changeDomainGrant),
    executeProfileTool: method(products => products.executeProfileTool),
    collection: method(products => products.collection),
    get: method(products => products.get),
    dependencies: method(products => products.dependencies),
    overlay: method(products => products.overlay),
    saveOverlay: method(products => products.saveOverlay),
  };
}
