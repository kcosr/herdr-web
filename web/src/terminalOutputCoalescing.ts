const TERMINAL_OUTPUT_FRAME_RAW = 0;
const TERMINAL_OUTPUT_FRAME_GZIP = 1;
const TERMINAL_OUTPUT_GZIP_ACKNOWLEDGEMENT =
  '{"type":"terminal_output_encoding","encoding":"gzip"}';

interface TerminalOutputFrameDecoder {
  enqueue(frame: Uint8Array): Promise<void>;
  cancel(): void;
}

export const DEFAULT_TERMINAL_OUTPUT_COALESCE_MS = 16;
export const TERMINAL_OUTPUT_COALESCE_OPTIONS_MS = [0, 8, 16, 32, 64, 128, 256] as const;

export function parseTerminalOutputCoalesceMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_TERMINAL_OUTPUT_COALESCE_MS;
  }
  return TERMINAL_OUTPUT_COALESCE_OPTIONS_MS.includes(
    value as (typeof TERMINAL_OUTPUT_COALESCE_OPTIONS_MS)[number],
  )
    ? value
    : DEFAULT_TERMINAL_OUTPUT_COALESCE_MS;
}

/** Returns whether a terminal control message enables gzip output frames. */
export function isTerminalOutputGzipAcknowledgement(message: string): boolean {
  return message === TERMINAL_OUTPUT_GZIP_ACKNOWLEDGEMENT;
}

/** Returns whether this browser can decode gzip terminal output frames. */
export function terminalOutputCompressionSupported(): boolean {
  return typeof DecompressionStream === "function";
}

/** Creates an ordered decoder for the stateful terminal output byte stream. */
export function createTerminalOutputFrameDecoder(
  write: (output: Uint8Array) => void,
  onError: (error: Error) => void,
): TerminalOutputFrameDecoder {
  let decodeChain = Promise.resolve();
  let canceled = false;
  let failed = false;

  return {
    enqueue(frame) {
      const decode = decodeChain.then(async () => {
        if (canceled || failed) {
          return;
        }
        const output = await decodeTerminalOutputFrame(frame);
        if (!canceled && !failed) {
          write(output);
        }
      });
      decodeChain = decode.catch((error: unknown) => {
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

/** Decodes one negotiated terminal output frame while preserving its original bytes. */
export async function decodeTerminalOutputFrame(frame: Uint8Array): Promise<Uint8Array> {
  const frameType = frame[0];
  const payload = frame.subarray(1);
  if (frameType === TERMINAL_OUTPUT_FRAME_RAW) {
    return payload;
  }
  if (frameType !== TERMINAL_OUTPUT_FRAME_GZIP) {
    throw new Error(`Unsupported terminal output frame type: ${String(frameType)}`);
  }

  const compressedBytes = Uint8Array.from(payload);
  const compressed = new Blob([compressedBytes.buffer]).stream();
  const decompressed = compressed.pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(decompressed).arrayBuffer());
}
