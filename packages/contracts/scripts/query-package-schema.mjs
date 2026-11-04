import { writeFile } from "node:fs/promises";
import { zodToJsonSchema } from "zod-to-json-schema";
import { queryPackageShapeSchema } from "../src/query-package.ts";
await writeFile(new URL("../src/query-package.schema.json", import.meta.url),
  JSON.stringify(zodToJsonSchema(queryPackageShapeSchema, { $refStrategy: "none" }), null, 2) + "\n");
