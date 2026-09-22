import { spawn } from "node:child_process";

const children = [
  spawn(process.execPath, ["--env-file-if-exists=.env.local", "--import", "tsx", "server/index.ts"], { stdio: "inherit" }),
  spawn(process.execPath, ["node_modules/vinext/dist/cli.js", "dev", "--port", "5173"], { stdio: "inherit" }),
];
const stop = () => children.forEach((child) => child.kill());
process.on("SIGINT", stop); process.on("SIGTERM", stop);
for (const child of children) child.on("exit", (code) => { if (code) process.exitCode = code; stop(); });
