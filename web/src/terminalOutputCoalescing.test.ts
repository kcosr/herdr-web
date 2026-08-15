import { describe, expect, it } from "vitest";
import {
  createTerminalOutputFrameDecoder,
  decodeTerminalOutputFrame,
  DEFAULT_TERMINAL_OUTPUT_COALESCE_MS,
  isTerminalOutputGzipAcknowledgement,
  parseTerminalOutputCoalesceMs,
} from "./terminalOutputCoalescing";

const HELLO_TERMINAL = new TextEncoder().encode("hello terminal\n");

const HELLO_TERMINAL_GZIP = new Uint8Array([
  31, 139, 8, 0, 0, 0, 0, 0, 4, 255, 203, 72, 205, 201, 201, 87, 40, 73, 45, 202, 205, 204, 75, 204,
  225, 2, 0, 235, 80, 240, 178, 15, 0, 0, 0,
]);

describe("terminal output coalescing preferences", () => {
  it("parses supported coalescing windows", () => {
    expect(parseTerminalOutputCoalesceMs(0)).toBe(0);
    expect(parseTerminalOutputCoalesceMs(8)).toBe(8);
    expect(parseTerminalOutputCoalesceMs(16)).toBe(16);
    expect(parseTerminalOutputCoalesceMs(32)).toBe(32);
    expect(parseTerminalOutputCoalesceMs(64)).toBe(64);
    expect(parseTerminalOutputCoalesceMs(128)).toBe(128);
    expect(parseTerminalOutputCoalesceMs(256)).toBe(256);
  });

  it("falls back for unsupported coalescing windows", () => {
    expect(parseTerminalOutputCoalesceMs(24)).toBe(DEFAULT_TERMINAL_OUTPUT_COALESCE_MS);
    expect(parseTerminalOutputCoalesceMs(512)).toBe(DEFAULT_TERMINAL_OUTPUT_COALESCE_MS);
    expect(parseTerminalOutputCoalesceMs("16")).toBe(DEFAULT_TERMINAL_OUTPUT_COALESCE_MS);
  });
});

describe("decodeTerminalOutputFrame", () => {
  it("returns raw terminal output without changing its bytes", async () => {
    const frame = new Uint8Array([0, ...HELLO_TERMINAL]);

    await expect(decodeTerminalOutputFrame(frame)).resolves.toEqual(HELLO_TERMINAL);
  });

  it("decompresses gzip terminal output", async () => {
    const frame = new Uint8Array([1, ...HELLO_TERMINAL_GZIP]);

    await expect(decodeTerminalOutputFrame(frame)).resolves.toEqual(HELLO_TERMINAL);
  });

  it("rejects unknown terminal output frame types", async () => {
    await expect(decodeTerminalOutputFrame(new Uint8Array([2, 1, 2, 3]))).rejects.toThrow(
      "Unsupported terminal output frame type: 2",
    );
  });
});

describe("isTerminalOutputGzipAcknowledgement", () => {
  it("accepts only the negotiated gzip acknowledgement", () => {
    expect(
      isTerminalOutputGzipAcknowledgement('{"type":"terminal_output_encoding","encoding":"gzip"}'),
    ).toBe(true);
    expect(isTerminalOutputGzipAcknowledgement('{"type":"closed"}')).toBe(false);
  });
});

describe("createTerminalOutputFrameDecoder", () => {
  it("writes decoded terminal output in WebSocket frame order", async () => {
    const writes: string[] = [];
    const decoder = createTerminalOutputFrameDecoder(
      (output) => writes.push(new TextDecoder().decode(output)),
      () => undefined,
    );

    const compressedFirst = decoder.enqueue(new Uint8Array([1, ...HELLO_TERMINAL_GZIP]));
    const rawSecond = decoder.enqueue(new Uint8Array([0, ...new TextEncoder().encode("second")]));
    await Promise.all([compressedFirst, rawSecond]);

    expect(writes).toEqual(["hello terminal\n", "second"]);
  });

  it("discards queued output after its WebSocket closes", async () => {
    const writes: Uint8Array[] = [];
    const decoder = createTerminalOutputFrameDecoder(
      (output) => writes.push(output),
      () => undefined,
    );

    const pending = decoder.enqueue(new Uint8Array([1, ...HELLO_TERMINAL_GZIP]));
    decoder.cancel();
    await pending;

    expect(writes).toEqual([]);
  });

  it("reports a decoding error once and stops the stream", async () => {
    const writes: Uint8Array[] = [];
    const errors: Error[] = [];
    const decoder = createTerminalOutputFrameDecoder(
      (output) => writes.push(output),
      (error) => errors.push(error),
    );

    await decoder.enqueue(new Uint8Array([2, 1, 2, 3]));
    await decoder.enqueue(new Uint8Array([0, ...HELLO_TERMINAL]));

    expect(errors).toHaveLength(1);
    expect(writes).toEqual([]);
  });
});
