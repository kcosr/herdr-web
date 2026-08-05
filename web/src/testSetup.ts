import { JSDOM } from "jsdom";

/**
 * Node 26 defines a built-in global `localStorage` accessor that throws away its
 * value unless the process was started with `--localstorage-file`. Because the
 * key already exists on `globalThis`, vitest's jsdom environment skips copying
 * jsdom's own `localStorage` over it, so DOM tests see `undefined` instead of a
 * Storage. Reinstate a real jsdom Storage for any test file that runs with a DOM.
 *
 * jsdom's Storage is not constructible directly (`Illegal constructor`), so we
 * borrow one from a throwaway document. Each test file gets its own setup run,
 * so storage stays isolated per file the same way the rest of the environment is.
 */
function installStorage(name: "localStorage" | "sessionStorage") {
  const existing = (globalThis as Record<string, unknown>)[name];
  if (existing && typeof (existing as Storage).getItem === "function") return;

  const { window } = new JSDOM("", { url: "http://localhost:3000" });
  Object.defineProperty(globalThis, name, {
    value: window[name],
    configurable: true,
    writable: true,
  });
}

if (typeof document !== "undefined") {
  installStorage("localStorage");
  installStorage("sessionStorage");
}
