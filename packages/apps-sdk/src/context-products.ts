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
    subscribe: method(products => products.subscribe),
    agentContext: method(products => products.agentContext),
    sourceTypes: method(products => products.sourceTypes),
    object: method(products => products.object),
    grants: method(products => products.grants),
    changeGrant: method(products => products.changeGrant),
    changeDomainGrant: method(products => products.changeDomainGrant),
    publish: method(products => products.publish),
    retryPublication: method(products => products.retryPublication),
    upgrade: method(products => products.upgrade),
    releases: method(products => products.releases),
    rollback: method(products => products.rollback),
    migrate: method(products => products.migrate),
    migrateDashboard: method(products => products.migrateDashboard),
    migratePlatform: method(products => products.migratePlatform),
    executeProfileTool: method(products => products.executeProfileTool),
    collection: method(products => products.collection),
    list: method(products => products.list),
    query: method(products => products.query),
    counts: method(products => products.counts),
    get: method(products => products.get),
    dependencies: method(products => products.dependencies),
    home: method(products => products.home),
    overlay: method(products => products.overlay),
    saveOverlay: method(products => products.saveOverlay),
    save: method(products => products.save),
    copy: method(products => products.copy),
    createPage: method(products => products.createPage),
    createDashboard: method(products => products.createDashboard),
    useHome: method(products => products.useHome),
    delete: method(products => products.delete),
  };
}
