import { spawn } from "node:child_process";

// The IPC channel is a lifetime signal only; no service secret crosses it.
process.on("disconnect", () => {
  if (process.platform === "win32")
    spawn("taskkill", ["/pid", String(process.pid), "/T", "/F"], {
      stdio: "ignore",
    }).unref();
  else process.kill(-process.pid, "SIGKILL");
});
// Merely registering a disconnect listener must not keep a completed skill alive.
process.channel?.unref();
