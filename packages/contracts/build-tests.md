# Build-test execution context

A preview request that runs on test data carries `X-Ontomato-Execution-Context` with
`{"kind":"build-test","contextId":"<id>|null"}`. `contextId: null` still means a test request; it must not be
dropped and retried as a live request.

## Support declarations

Java methods declare support with `@BuildTestAccess(TEST_DATA | NO_BUSINESS_DATA)`; Node routes declare the
allowed method and path in `packages/workbench-server/src/api/build-test-access.ts`, next to the route module
that owns them.

- `TEST_DATA`: every executable branch uses the resolved test target, or fails before side effects.
- `NO_BUSINESS_DATA`: reads definitions or metadata, converts parameters, or verifies identity. It never reads
  or writes business instances, never starts their execution, and does not include pure management writes.

An entry without a declaration refuses the request before its controller, route handler, query service or
executor runs. Reading the context's own status is a metadata operation, not a business execution.

## Refusal

Java returns HTTP 422 with `{success:false,code:"BUILD_TEST_UNSUPPORTED",message}` and writes the response
directly. Node returns HTTP 422 with its existing `{success:false,error,code}` envelope. Both use the code
`BUILD_TEST_UNSUPPORTED`. A request without the header keeps its original path.

A query grant and an execution context are separate authorities: a `TEST_DATA` entry refuses a request that
also carries a grant with a `contextId` instead of merging the two.
