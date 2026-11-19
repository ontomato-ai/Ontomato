import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { authoringWireSchemas } from "../src/authoring.ts";

const { $schema, definitions } = zodToJsonSchema(z.never(), { definitions: authoringWireSchemas });
const schema = { $schema, $ref: "#/definitions/hostRun", definitions };
await writeFile(new URL("../src/authoring.schema.json", import.meta.url), JSON.stringify(schema, null, 2) + "\n");
