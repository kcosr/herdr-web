#!/usr/bin/env node

import { constants as fsConstants } from "node:fs";
import { access, stat } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB_DIR = path.join(ROOT, "web");
const DEFAULT_BRIDGE_BIN = path.join(
  ROOT,
  "bridge",
  "target",
  "debug",
  process.platform === "win32" ? "herdr-web-bridge.exe" : "herdr-web-bridge",
);
const DEFAULT_STATIC_DIR = path.join(WEB_DIR, "dist");
const START_TIMEOUT_MS = 15_000;
const SHUTDOWN_TIMEOUT_MS = 3_000;

class ChildExitError extends Error {
  constructor(label, result) {
    const detail = result.code === null ? `signal ${result.signal}` : `status ${result.code}`;
    super(`${label} exited before it became ready (${detail})`);
    this.result = result;
  }
}

class RequestedSignalError extends Error {
  constructor(signal) {
    super(`received ${signal}`);
    this.signal = signal;
  }
}

function parsePort(name, fallback) {
  const raw = process.env[name] ?? String(fallback);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535 (received ${JSON.stringify(raw)})`);
  }
  return value;
}

function configuredHost(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value.length === 0) {
    throw new Error(`${name} must not be empty`);
  }
  return value;
}

function connectHost(bindHost) {
  if (bindHost === "0.0.0.0") return "127.0.0.1";
  if (bindHost === "::") return "::1";
  return bindHost;
}

function httpUrl(host, port) {
  const urlHost = net.isIP(host) === 6 ? `[${host}]` : host;
  return `http://${urlHost}:${port}`;
}

function childResult(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function pathIsExecutable(filePath) {
  try {
    await access(
      filePath,
      process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK,
    );
    return true;
  } catch {
    return false;
  }
}

async function directoryExists(directory) {
  try {
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

function spawnChild(command, args, options = {}) {
  return spawn(command, args, {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit",
    detached: process.platform !== "win32",
    ...options,
  });
}

async function runCommand(command, args, signalPromise) {
  const child = spawnChild(command, args);
  const exited = childResult(child);
  const outcome = await Promise.race([
    exited.then((result) => ({ source: "child", result })),
    signalPromise,
  ]);
  if (outcome.source === "signal") {
    await stopChild(child, command);
    throw new RequestedSignalError(outcome.signal);
  }
  const { result } = outcome;
  if (result.code !== 0) {
    const detail = result.code === null ? `signal ${result.signal}` : `status ${result.code}`;
    throw new Error(`${command} failed (${detail})`);
  }
}

function sendSignal(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (!Number.isInteger(child.pid)) return;
  try {
    if (process.platform === "win32") {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function stopChild(child, label) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = childResult(child);
  sendSignal(child, "SIGTERM");
  let timeout;
  const result = await Promise.race([
    exited,
    new Promise((resolve) => {
      timeout = setTimeout(() => resolve(null), SHUTDOWN_TIMEOUT_MS);
    }),
  ]);
  clearTimeout(timeout);
  if (result !== null) return;

  console.error(`${label} did not stop after ${SHUTDOWN_TIMEOUT_MS}ms; killing it`);
  sendSignal(child, "SIGKILL");
  await exited.catch(() => {});
}

async function portIsOccupied(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (occupied) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(occupied);
    };
    socket.setTimeout(300);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function waitForBridgeReady(url, bridge, exitPromise, signalPromise) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  let lastFailure = "no response";
  while (Date.now() < deadline) {
    if (bridge.exitCode !== null || bridge.signalCode !== null) {
      throw new ChildExitError("bridge", await exitPromise);
    }
    try {
      const response = await fetch(`${url}/api/capabilities`, {
        signal: AbortSignal.timeout(500),
      });
      if (!response.ok) {
        lastFailure = `HTTP ${response.status}`;
        await response.body?.cancel();
      } else {
        const capabilities = await response.json();
        if (Array.isArray(capabilities?.commands)) {
          if (bridge.exitCode === null && bridge.signalCode === null) return;
        } else {
          lastFailure = "invalid capabilities response";
        }
      }
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }

    const outcome = await Promise.race([
      exitPromise.then((result) => ({ source: "bridge", result })),
      signalPromise,
      delay(100).then(() => ({ source: "delay" })),
    ]);
    if (outcome.source === "bridge") throw new ChildExitError("bridge", outcome.result);
    if (outcome.source === "signal") throw new RequestedSignalError(outcome.signal);
  }
  throw new Error(
    `bridge did not become ready at ${url} within ${START_TIMEOUT_MS}ms (${lastFailure})`,
  );
}

function stableSocketEnvironment() {
  const env = { ...process.env };
  if (env.HERDR_SOCKET_PATH) return env;
  const configHome = env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  env.HERDR_SOCKET_PATH = path.join(configHome, "herdr", "herdr.sock");
  return env;
}

function rejectAddressOverrides(args) {
  const reserved = new Set(["--host", "--port", "--static-dir"]);
  for (const argument of args) {
    if (reserved.has(argument) || [...reserved].some((option) => argument.startsWith(`${option}=`))) {
      throw new Error(
        `${argument} is controlled by the dev server; use HERDR_WEB_BRIDGE_HOST, ` +
          "HERDR_WEB_BRIDGE_PORT, or HERDR_WEB_STATIC_DIR",
      );
    }
  }
}

function exitStatus(result, unexpected) {
  if (result.code !== null) {
    return unexpected && result.code === 0 ? 1 : result.code;
  }
  return result.signal === "SIGINT" ? 130 : result.signal === "SIGTERM" ? 143 : 1;
}

async function main() {
  let bridge;
  let vite;
  let requestedSignal;
  let resolveSignal;
  const signalPromise = new Promise((resolve) => {
    resolveSignal = resolve;
  });
  const handleSignal = (signal) => {
    if (requestedSignal) return;
    requestedSignal = signal;
    resolveSignal({ source: "signal", signal });
  };
  const handleSigint = () => handleSignal("SIGINT");
  const handleSigterm = () => handleSignal("SIGTERM");
  process.once("SIGINT", handleSigint);
  process.once("SIGTERM", handleSigterm);

  try {
    const bridgeHost = configuredHost("HERDR_WEB_BRIDGE_HOST", "127.0.0.1");
    const bridgePort = parsePort("HERDR_WEB_BRIDGE_PORT", 8787);
    const devHost = configuredHost("HERDR_WEB_DEV_HOST", "127.0.0.1");
    const devPort = parsePort("HERDR_WEB_DEV_PORT", 5173);
    const configuredBridgeBin = process.env.HERDR_WEB_BRIDGE_BIN;
    const bridgeBin = path.resolve(ROOT, configuredBridgeBin ?? DEFAULT_BRIDGE_BIN);
    const staticDir = path.resolve(ROOT, process.env.HERDR_WEB_STATIC_DIR ?? DEFAULT_STATIC_DIR);
    const bridgeArgs = process.argv.slice(2);
    rejectAddressOverrides(bridgeArgs);

    if (!(await directoryExists(path.join(WEB_DIR, "node_modules")))) {
      throw new Error("web dependencies are missing; run: npm install --prefix web");
    }
    if (!(await pathIsExecutable(bridgeBin))) {
      if (configuredBridgeBin) {
        throw new Error(`HERDR_WEB_BRIDGE_BIN is not executable: ${bridgeBin}`);
      }
      console.log("bridge binary is missing; building it first...");
      await runCommand(
        process.platform === "win32" ? "npm.cmd" : "npm",
        ["run", "bridge:build"],
        signalPromise,
      );
    }
    if (requestedSignal) throw new RequestedSignalError(requestedSignal);
    if (!(await pathIsExecutable(bridgeBin))) {
      throw new Error(`bridge build did not produce an executable at ${bridgeBin}`);
    }

    const proxyHost = connectHost(bridgeHost);
    const bridgeUrl = httpUrl(proxyHost, bridgePort);
    if (await portIsOccupied(proxyHost, bridgePort)) {
      throw new Error(
        `bridge address ${bridgeUrl} is already in use; ` +
          "stop that process or set HERDR_WEB_BRIDGE_PORT",
      );
    }
    if (requestedSignal) throw new RequestedSignalError(requestedSignal);

    const bridgeEnv = stableSocketEnvironment();
    console.log(`starting bridge on ${httpUrl(bridgeHost, bridgePort)}`);
    console.log(`  HERDR_SOCKET_PATH=${bridgeEnv.HERDR_SOCKET_PATH ?? "<unset>"}`);
    bridge = spawnChild(
      bridgeBin,
      [...bridgeArgs, "--host", bridgeHost, "--port", String(bridgePort), "--static-dir", staticDir],
      { env: bridgeEnv },
    );
    const bridgeExit = childResult(bridge);
    await waitForBridgeReady(bridgeUrl, bridge, bridgeExit, signalPromise);

    console.log(`starting Vite HMR on ${httpUrl(devHost, devPort)} (proxy -> ${bridgeUrl})`);
    console.log("open the Vite URL; bridge source changes still require a rebuild and restart");
    const viteEnv = { ...process.env, HERDR_WEB_BRIDGE: bridgeUrl };
    vite = spawnChild(
      process.platform === "win32" ? "npm.cmd" : "npm",
      [
        "--prefix",
        WEB_DIR,
        "run",
        "dev",
        "--",
        "--host",
        devHost,
        "--port",
        String(devPort),
        "--strictPort",
      ],
      { env: viteEnv },
    );
    const viteExit = childResult(vite);

    const outcome = await Promise.race([
      bridgeExit.then((result) => ({ source: "bridge", result })),
      viteExit.then((result) => ({ source: "vite", result })),
      signalPromise,
    ]);
    if (outcome.source === "signal") {
      return outcome.signal === "SIGINT" ? 130 : 143;
    }
    if (outcome.source === "bridge") {
      console.error("bridge stopped; shutting down Vite");
      return exitStatus(outcome.result, true);
    }
    return exitStatus(outcome.result, false);
  } catch (error) {
    if (error instanceof ChildExitError) return exitStatus(error.result, true);
    if (error instanceof RequestedSignalError) return error.signal === "SIGINT" ? 130 : 143;
    throw error;
  } finally {
    process.removeListener("SIGINT", handleSigint);
    process.removeListener("SIGTERM", handleSigterm);
    await Promise.all([stopChild(vite, "Vite"), stopChild(bridge, "bridge")]);
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`dev server failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
