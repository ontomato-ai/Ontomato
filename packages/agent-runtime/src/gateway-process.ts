import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runtimeLogger } from "./logging";

/** Where the gateway's sources are, next to this package's compiled sources. */
const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), "../gateway/server.py");

export interface ModelGatewayAddresses {
  controlUrl: string;
  dataUrl: string;
}

/**
 * The gateway process this deployment's model calls go through. It is one Python process running the LiteLLM SDK: the
 * control plane it prints at startup is only for the runtime, and the data plane is what leases address.
 */
export class ModelGatewayProcess {
  private constructor(readonly addresses: ModelGatewayAddresses, private readonly child: ChildProcess) {}

  static async start(python: string): Promise<ModelGatewayProcess> {
    const child = spawn(python, [SERVER], { stdio: ["ignore", "pipe", "pipe"] });
    child.stderr.on("data", (chunk: Buffer) => runtimeLogger.info("model gateway", { kind: "downstream", target: "model-gateway", message: chunk.toString().trim() }));
    const ports = await new Promise<{ control: number; data: number }>((resolve, reject) => {
      let out = "";
      child.once("error", reject);
      child.once("exit", (code, received) => reject(new Error(`Model gateway exited (code ${code}, signal ${received})`)));
      child.stdout!.on("data", (chunk: Buffer) => {
        out += chunk.toString();
        const line = out.split("\n")[0];
        if (!out.includes("\n") || !line) return;
        resolve(JSON.parse(line));
      });
    });
    return new ModelGatewayProcess({
      controlUrl: `http://127.0.0.1:${ports.control}`,
      dataUrl: `http://127.0.0.1:${ports.data}`,
    }, child);
  }

  /** The application's exit stops the gateway with it; leases live only in its memory, so nothing is left behind. */
  async stop(): Promise<void> {
    if (this.child.exitCode !== null) return;
    const exited = new Promise<void>(resolve => this.child.once("exit", () => resolve()));
    this.child.kill("SIGTERM");
    await exited;
  }
}
