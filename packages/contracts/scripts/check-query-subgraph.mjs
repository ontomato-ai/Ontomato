import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp, rm, copyFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { zodToJsonSchema } from "zod-to-json-schema";
import { querySubgraphSchema, querySubgraphShapeSchema } from "../src/query-subgraph.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const schema = new URL("../src/query-subgraph.schema.json", import.meta.url);
assert.deepEqual(JSON.parse(await readFile(schema, "utf8")),
  zodToJsonSchema(querySubgraphShapeSchema, { $refStrategy: "none" }));
const examples = JSON.parse(await readFile(new URL("../examples/query-subgraphs.json", import.meta.url), "utf8"));
const cases = Object.entries(examples).map(([name, graph]) => ({ name, graph, valid: true }));
for (const [name, change] of Object.entries({
  unknownProperty: (g) => { g.nodes[0].permission = "allow"; },
  unknownEndpoint: (g) => { g.edges[0].target = "missing"; },
  duplicateOutput: (g) => { g.nodes.filter((n) => n.kind === "output")[1].key = "department"; },
  wrongOwner: (g) => { g.edges.find((e) => e.kind === "contains").source = "salary"; },
  reversedHops: (g) => { g.edges.find((e) => e.kind === "relation").hops = { min: 2, max: 1 }; },
  unknownQuery: (g) => { g.nodes[0].queryId = "missing"; },
  cycle: (g) => { g.edges.push({ id: "cycle", kind: "dependency", source: "salary-sum", target: "salary-sum", role: "value", label: "" }); },
})) {
  const graph = structuredClone(examples.singleDsl); change(graph); cases.push({ name, graph, valid: false });
}
for (const { name, graph, valid } of cases) assert.equal(querySubgraphSchema.safeParse(graph).success, valid, name);

const pom = await readFile(join(root, "pom.xml"), "utf8");
const version = pom.match(/<artifactId>fastjson2<\/artifactId>\s*<version>([^<]+)<\/version>/)[1];
const jar = process.env.FASTJSON_JAR ?? join(homedir(), ".m2", "repository", "com", "alibaba", "fastjson2", "fastjson2", version, `fastjson2-${version}.jar`);
const work = await mkdtemp(join(tmpdir(), "ontomato-subgraph-contract-"));
try {
  await mkdir(join(work, "ontology-contracts"));
  await copyFile(schema, join(work, "ontology-contracts", "query-subgraph.schema.json"));
  await writeFile(join(work, "cases.json"), JSON.stringify(cases));
  await writeFile(join(work, "ContractCheck.java"), `
import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.service.QuerySubgraphContract;
import java.nio.file.*;
public class ContractCheck {
  public static void main(String[] args) throws Exception {
    for (Object value : JSON.parseArray(Files.readString(Path.of(args[0])))) {
      JSONObject test = JSONObject.from(value);
      boolean accepted = true;
      try { QuerySubgraphContract.validate(test.getJSONObject("graph")); }
      catch (IllegalArgumentException rejected) { accepted = false; }
      if (accepted != test.getBooleanValue("valid")) throw new AssertionError(test.getString("name"));
    }
  }
}`);
  execFileSync("javac", ["-cp", jar, "-d", work,
    join(root, "packages/data-engine-core/src/main/java/io/ontomato/dataengine/service/QuerySubgraphContract.java"),
    join(work, "ContractCheck.java")], { stdio: "inherit" });
  execFileSync("java", ["-cp", [work, jar].join(delimiter), "ContractCheck", join(work, "cases.json")], { stdio: "inherit" });
  console.log(`Query subgraph contract: ${cases.length} shared TS/Java cases passed`);
} finally { await rm(work, { recursive: true, force: true }); }
