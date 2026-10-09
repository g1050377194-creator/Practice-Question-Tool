import { spawn } from "node:child_process";

const flag = "--experimental-sqlite";
const current = process.env.NODE_OPTIONS ?? "";
const nodeOptions = current.includes(flag) ? current : `${current} ${flag}`.trim();

const child = spawn(process.execPath, process.argv.slice(2), {
  stdio: "inherit",
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
