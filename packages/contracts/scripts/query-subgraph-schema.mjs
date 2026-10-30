import { writeFile } from "node:fs/promises";
import { zodToJsonSchema } from "zod-to-json-schema";
import { querySubgraphShapeSchema } from "../src/query-subgraph.ts";

await writeFile(new URL("../src/query-subgraph.schema.json", import.meta.url),
  JSON.stringify(zodToJsonSchema(querySubgraphShapeSchema, { $refStrategy: "none" }), null, 2) + "\n");
