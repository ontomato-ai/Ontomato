import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { authoringWireSchemas } from "../src/authoring.ts";

// Java loads a definition directly with fastjson2, which cannot resolve nested $ref references.
const { $schema, definitions: javaDefinitions } = zodToJsonSchema(z.never(), {
  definitions: authoringWireSchemas,
  $refStrategy: "none",
});
const javaSchema = { $schema, definitions: javaDefinitions };
await writeFile(new URL("../src/authoring.java.schema.json", import.meta.url), JSON.stringify(javaSchema, null, 2) + "\n");
