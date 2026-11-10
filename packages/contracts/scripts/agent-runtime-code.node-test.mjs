import assert from "node:assert/strict";
import test from "node:test";
import {
  codeExecutionRequestSchema,
  codeExecutionVirtualAddressSpaceBytes,
} from "../src/agent-runtime-code.ts";

const request = (limits) => codeExecutionRequestSchema.parse({
  language: "python",
  files: [{ path: "program.py", content: "print('ok')" }],
  entry: "program.py",
  arguments: [],
  outputPaths: [],
  environment: { values: {}, secrets: {} },
  libraries: [],
  limits,
});

test("standalone Python requests retain the 1 GiB default", () => {
  assert.equal(request({}).limits.memoryBytes, 1024 ** 3);
});

test("a Node launcher can request the shared address space budget without widening other limits", () => {
  const defaults = request({}).limits;
  const node = request({ memoryBytes: codeExecutionVirtualAddressSpaceBytes }).limits;
  assert.ok(node.memoryBytes > defaults.memoryBytes);
  assert.deepEqual(node, { ...defaults, memoryBytes: codeExecutionVirtualAddressSpaceBytes });
});
