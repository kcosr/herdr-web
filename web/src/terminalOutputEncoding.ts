const TERMINAL_OUTPUT_FRAME_RAW = 0;
const TERMINAL_OUTPUT_FRAME_GZIP = 1;

type TerminalOutputFrameDecoder = {
  enqueue(frame: Uint8Array): Promise<void>;
  cancel(): void;
};

export function isTerminalOutputGzipAcknowledgement(message: string): boolean {
  try {
    const parsed = JSON.parse(message) as { type?: unknown; encoding?: unknown };
    return parsed.type === "terminal_output_encoding" && parsed.encoding === "gzip";
  } catch {
    return false;
  }
}

export function terminalOutputGzipSupported(): boolean {
  return typeof DecompressionStream === "function";
}

export function createTerminalOutputFrameDecoder(
  write: (output: Uint8Array) => void,
  onError: (error: Error) => void,
): TerminalOutputFrameDecoder {
  let decodeChain = Promise.resolve();
  let canceled = false;
  let failed = false;

  return {
    enqueue(frame) {
      decodeChain = decodeChain
        .then(async () => {
          if (canceled || failed) {
            return;
          }
          const output = await decodeTerminalOutputFrame(frame);
          if (!canceled && !failed) {
            write(output);
          }
        })
        .catch((error: unknown) => {
          if (!canceled && !failed) {
            failed = true;
            onError(
              error instanceof Error
                ? error
                : new Error("Terminal output decompression failed", { cause: error }),
            );
          }
        });
      return decodeChain;
    },
    cancel() {
      canceled = true;
    },
  };
}

export async function decodeTerminalOutputFrame(frame: Uint8Array): Promise<Uint8Array> {
  const frameType = frame[0];
  const payload = frame.subarray(1);
  if (frameType === TERMINAL_OUTPUT_FRAME_RAW) {
    return payload;
  }
  if (frameType !== TERMINAL_OUTPUT_FRAME_GZIP) {
    throw new Error(`Unsupported terminal output frame type: ${frameType}`);
  }

  // subarray() keeps the ArrayBufferLike base type, which Blob rejects under strict
  // TypeScript. Copy into a fresh ArrayBuffer-backed view before streaming.
  const compressedBytes = Uint8Array.from(payload);
  const decompressed = new Blob([compressedBytes.buffer])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(decompressed).arrayBuffer());
}
