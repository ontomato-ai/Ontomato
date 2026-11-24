import { chown, chmod } from "node:fs/promises";
import { connect, createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";

export const gatewayPort = 17001;
export const callbackPort = 17002;

export interface SandboxEndpoint {
  readonly host: string;
  readonly port: number;
}

export interface SandboxEndpoints {
  readonly gateway: SandboxEndpoint;
  readonly callback: SandboxEndpoint;
}

export async function openSandboxRelays(directory: string, uid: number, endpoints: SandboxEndpoints) {
  const servers: Server[] = [];
  const connections = new Set<Socket>();
  const close = async () => {
    for (const socket of connections) socket.destroy();
    await Promise.all(servers.map(server => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    })));
  };
  try {
    for (const [name, destination] of (["gateway", "callback"] as const).map(name => [name, endpoints[name]] as const)) {
      const filename = join(directory, name + ".sock");
      const server = createServer({ allowHalfOpen: true }, incoming => {
        const outgoing = connect({ ...destination, allowHalfOpen: true });
        const forward = (source: Socket, target: Socket) => {
          connections.add(source);
          source.on("error", error => target.destroy(error));
          source.once("close", () => {
            connections.delete(source);
            target.destroy();
          });
          source.pipe(target);
        };
        forward(incoming, outgoing);
        forward(outgoing, incoming);
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(filename, () => {
          server.off("error", reject);
          resolve();
        });
      });
      servers.push(server);
      await chown(filename, uid, uid);
      await chmod(filename, 0o600);
    }
    return close;
  } catch (error) {
    await close();
    throw error;
  }
}
