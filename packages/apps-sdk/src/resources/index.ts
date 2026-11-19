import type { PlatformObjectAdapterFactory } from "../panel/platform-objects";

/*
 * The resource adapters of this SDK version (design 2.3): one module per owner, each written against
 * `PlatformObjectAdapter` and sending only the requests `contracts/panel-client-requests.ts` declares for its binding.
 * A panel's frame registers every one of them with its own request path when it mounts; a type not listed here is one
 * no projection of this version can bind.
 */
export const platformObjectAdapters: readonly PlatformObjectAdapterFactory[] = [];
