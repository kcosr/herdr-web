import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEV_SCRIPT = path.join(ROOT, "scripts", "dev.mjs");

const FAKE_BRIDGE = `#!/usr/bin/env node
const http = require("node:http");
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_BRIDGE_LOG, JSON.stringify(args) + "\\n");
if (process.env.FAKE_BRIDGE_FAIL) process.exit(Number(process.env.FAKE_BRIDGE_FAIL));
const valueAfter = (name) => args[args.lastIndexOf(name) + 1];
const server = http.createServer((request, response) => {
  const status = request.url === "/api/capabilities"
    ? Number(process.env.FAKE_BRIDGE_STATUS || 200)
    : 404;
  response.writeHead(status, { "content-type": "application/json" });
  response.end(status === 200 ? '{"commands":[]}' : '{}');
});
const stop = () => {
  fs.appendFileSync(process.env.FAKE_BRIDGE_STOP_LOG, "stopped\\n");
  server.close(() => process.exit(0));
  server.closeAllConnections?.();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
server.listen(Number(valueAfter("--port")), valueAfter("--host"));
if (process.env.FAKE_BRIDGE_EXIT_AFTER_MS) {
  setTimeout(
    () => process.exit(Number(process.env.FAKE_BRIDGE_EXIT_CODE || 1)),
    Number(process.env.FAKE_BRIDGE_EXIT_AFTER_MS),
  );
}
`;

const FAKE_NPM = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("bridge:build") && process.env.FAKE_BUILD_HANG) {
  fs.appendFileSync(process.env.FAKE_BUILD_LOG, "started\\n");
  const stop = () => {
    fs.appendFileSync(process.env.FAKE_BUILD_STOP_LOG, "stopped\\n");
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  setInterval(() => {}, 1000);
} else {
  fs.appendFileSync(process.env.FAKE_VITE_LOG, JSON.stringify({
    args,
    bridge: process.env.HERDR_WEB_BRIDGE,
  }) + "\\n");
  const stop = () => {
    fs.appendFileSync(process.env.FAKE_VITE_STOP_LOG, "stopped\\n");
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  if (process.env.FAKE_VITE_EXIT_MS) {
    setTimeout(() => process.exit(Number(process.env.FAKE_VITE_EXIT_CODE || 0)), Number(process.env.FAKE_VITE_EXIT_MS));
  }
  setInterval(() => {}, 1000);
}
`;

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function makeFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "herdr-web-dev-test-"));
  const binDirectory = path.join(directory, "bin");
  const bridgeBin = path.join(directory, "fake-bridge");
  await mkdir(binDirectory);
  await writeFile(bridgeBin, FAKE_BRIDGE);
  await writeFile(path.join(binDirectory, "npm"), FAKE_NPM);
  await chmod(bridgeBin, 0o755);
  await chmod(path.join(binDirectory, "npm"), 0o755);
  return {
    directory,
    bridgeBin,
    bridgeLog: path.join(directory, "bridge.log"),
    bridgeStopLog: path.join(directory, "bridge-stop.log"),
    viteLog: path.join(directory, "vite.log"),
    viteStopLog: path.join(directory, "vite-stop.log"),
    buildLog: path.join(directory, "build.log"),
    buildStopLog: path.join(directory, "build-stop.log"),
  };
}

function runDev(fixture, bridgePort, extraEnv = {}, extraArgs = []) {
  const env = {
    ...process.env,
    PATH: `${path.join(fixture.directory, "bin")}${path.delimiter}${process.env.PATH}`,
    HERDR_WEB_BRIDGE_BIN: fixture.bridgeBin,
    HERDR_WEB_BRIDGE_HOST: "127.0.0.1",
    HERDR_WEB_BRIDGE_PORT: String(bridgePort),
    HERDR_WEB_DEV_HOST: "127.0.0.1",
    HERDR_WEB_DEV_PORT: String(bridgePort + 1),
    FAKE_BRIDGE_LOG: fixture.bridgeLog,
    FAKE_BRIDGE_STOP_LOG: fixture.bridgeStopLog,
    FAKE_VITE_LOG: fixture.viteLog,
    FAKE_VITE_STOP_LOG: fixture.viteStopLog,
    FAKE_BUILD_LOG: fixture.buildLog,
    FAKE_BUILD_STOP_LOG: fixture.buildStopLog,
    ...extraEnv,
  };
  const child = spawn(process.execPath, [DEV_SCRIPT, ...extraArgs], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const result = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal, output }));
  });
  return { child, result };
}

async function stopRun(run) {
  if (!run) return;
  if (run.child.exitCode === null && run.child.signalCode === null) {
    run.child.kill("SIGTERM");
  }
  let timeout;
  const stopped = await Promise.race([
    run.result.then(() => true),
    new Promise((resolve) => {
      timeout = setTimeout(() => resolve(false), 5_000);
    }),
  ]);
  clearTimeout(timeout);
  if (!stopped && run.child.exitCode === null && run.child.signalCode === null) {
    run.child.kill("SIGKILL");
  }
  await run.result;
}

async function fileText(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

async function waitForFile(filePath) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if ((await fileText(filePath)).length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${filePath}`);
}

test("Vite exit stops the bridge and preserves configured arguments", { concurrency: false }, async () => {
  const fixture = await makeFixture();
  let run;
  try {
    const port = await reservePort();
    run = runDev(
      fixture,
      port,
      {
        FAKE_VITE_EXIT_MS: "100",
        HERDR_WEB_BRIDGE: "http://wrong.example:9999",
        HOST: "0.0.0.0",
        PORT: "1",
      },
      ["--session", "dev session"],
    );
    const outcome = await run.result;
    assert.equal(outcome.code, 0, outcome.output);
    assert.match(await fileText(fixture.bridgeStopLog), /stopped/);

    const bridgeArgs = JSON.parse((await fileText(fixture.bridgeLog)).trim());
    assert.deepEqual(bridgeArgs.slice(0, 2), ["--session", "dev session"]);
    assert.deepEqual(bridgeArgs.slice(-6), [
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--static-dir",
      path.join(ROOT, "web", "dist"),
    ]);
    const vite = JSON.parse((await fileText(fixture.viteLog)).trim());
    assert.equal(vite.bridge, `http://127.0.0.1:${port}`);
    assert.deepEqual(vite.args.slice(-6), [
      "--",
      "--host",
      "127.0.0.1",
      "--port",
      String(port + 1),
      "--strictPort",
    ]);
  } finally {
    await stopRun(run);
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("bridge startup failure does not start Vite", { concurrency: false }, async () => {
  const fixture = await makeFixture();
  let run;
  try {
    const port = await reservePort();
    run = runDev(fixture, port, { FAKE_BRIDGE_FAIL: "23" });
    const outcome = await run.result;
    assert.equal(outcome.code, 23, outcome.output);
    assert.equal(await fileText(fixture.viteLog), "");
  } finally {
    await stopRun(run);
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("unhealthy capabilities response does not start Vite", { concurrency: false }, async () => {
  const fixture = await makeFixture();
  let run;
  try {
    const port = await reservePort();
    run = runDev(fixture, port, {
      FAKE_BRIDGE_STATUS: "503",
      FAKE_BRIDGE_EXIT_AFTER_MS: "200",
      FAKE_BRIDGE_EXIT_CODE: "24",
    });
    const outcome = await run.result;
    assert.equal(outcome.code, 24, outcome.output);
    assert.equal(await fileText(fixture.viteLog), "");
  } finally {
    await stopRun(run);
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("SIGTERM stops both managed processes", { concurrency: false }, async () => {
  const fixture = await makeFixture();
  let run;
  try {
    const port = await reservePort();
    run = runDev(fixture, port);
    await waitForFile(fixture.viteLog);
    run.child.kill("SIGTERM");
    const outcome = await run.result;
    assert.equal(outcome.code, 143, outcome.output);
    assert.match(await fileText(fixture.bridgeStopLog), /stopped/);
    assert.match(await fileText(fixture.viteStopLog), /stopped/);
  } finally {
    await stopRun(run);
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("SIGTERM during an automatic bridge build stops the build process", { concurrency: false }, async () => {
  const fixture = await makeFixture();
  let run;
  try {
    const projectRoot = path.join(fixture.directory, "project");
    const scriptPath = path.join(projectRoot, "scripts", "dev.mjs");
    await mkdir(path.join(projectRoot, "scripts"), { recursive: true });
    await mkdir(path.join(projectRoot, "web", "node_modules"), { recursive: true });
    await copyFile(DEV_SCRIPT, scriptPath);
    const env = {
      ...process.env,
      PATH: `${path.join(fixture.directory, "bin")}${path.delimiter}${process.env.PATH}`,
      FAKE_BUILD_HANG: "1",
      FAKE_BUILD_LOG: fixture.buildLog,
      FAKE_BUILD_STOP_LOG: fixture.buildStopLog,
    };
    delete env.HERDR_WEB_BRIDGE_BIN;
    const child = spawn(process.execPath, [scriptPath], {
      cwd: projectRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const result = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal, output }));
    });
    run = { child, result };

    await waitForFile(fixture.buildLog);
    child.kill("SIGTERM");
    const outcome = await result;
    assert.equal(outcome.code, 143, outcome.output);
    assert.match(await fileText(fixture.buildStopLog), /stopped/);
  } finally {
    await stopRun(run);
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
