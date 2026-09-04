import { afterEach, describe, expect, it, vi } from "vitest";

import { uploadWithOverwritePrompt } from "./terminalUploads";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadWithOverwritePrompt", () => {
  it("requests atomic conflict renaming when the setting is enabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue(uploadResponse("image-1.png"));
    vi.stubGlobal("fetch", fetchMock);
    const confirmReplace = vi.fn();

    const uploaded = await uploadWithOverwritePrompt(
      testHttpUrl,
      imageFile(),
      true,
      confirmReplace,
    );

    expect(uploaded.name).toBe("image-1.png");
    expect(requestQuery(fetchMock)).toEqual({
      name: "image.png",
      rename_conflicts: "true",
    });
    expect(confirmReplace).not.toHaveBeenCalled();
  });

  it("keeps the Replace or Cancel prompt when automatic renaming is disabled", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(conflictResponse("image.png"))
      .mockResolvedValueOnce(uploadResponse("image.png"));
    vi.stubGlobal("fetch", fetchMock);
    const confirmReplace = vi.fn().mockResolvedValue(true);

    await uploadWithOverwritePrompt(testHttpUrl, imageFile(), false, confirmReplace);

    expect(confirmReplace).toHaveBeenCalledOnce();
    expect(requestQuery(fetchMock, 0)).toEqual({ name: "image.png" });
    expect(requestQuery(fetchMock, 1)).toEqual({ name: "image.png", overwrite: "true" });
  });

  it("does not offer replacement when automatic suffixes are exhausted", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "no available filename for image.png" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const confirmReplace = vi.fn();

    await expect(
      uploadWithOverwritePrompt(testHttpUrl, imageFile(), true, confirmReplace),
    ).rejects.toThrow("no available filename for image.png");
    expect(confirmReplace).not.toHaveBeenCalled();
  });
});

function imageFile() {
  return {
    blob: new Blob(["image"], { type: "image/png" }),
    name: "image.png",
  };
}

function testHttpUrl(path: string, query?: URLSearchParams) {
  const suffix = query && query.size > 0 ? `?${query}` : "";
  return `http://bridge.test${path}${suffix}`;
}

function uploadResponse(name: string) {
  return new Response(
    JSON.stringify({
      file: {
        name,
        path: `/uploads/${name}`,
        size: 5,
        mime: "image/png",
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function conflictResponse(name: string) {
  return new Response(
    JSON.stringify({ error: "file exists", name, path: `/uploads/${name}` }),
    { status: 409, headers: { "content-type": "application/json" } },
  );
}

function requestQuery(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  const url = new URL(String(fetchMock.mock.calls[call]?.[0]));
  return Object.fromEntries(url.searchParams.entries());
}
