import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  ChatRequestBodyError,
  readChatRequestBody,
} from "../../../../src/modules/chat/relay/request-body";

const json = JSON.stringify({ model: "m", messages: [] });

describe("chat request body", () => {
  it.each([
    ["gzip", gzipSync(json)],
    ["deflate", deflateSync(json)],
    ["br", brotliCompressSync(json)],
  ])("decompresses %s", async (encoding, body) => {
    const request = new Request("http://test/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Encoding": encoding },
      body,
    });
    await expect(readChatRequestBody(request, 1024)).resolves.toBe(json);
  });

  it("enforces the decompressed limit", async () => {
    const request = new Request("http://test", {
      method: "POST",
      headers: { "Content-Encoding": "gzip" },
      body: gzipSync("a".repeat(100)),
    });
    await expect(readChatRequestBody(request, 50)).rejects.toMatchObject({
      status: 413,
      code: "request_body_too_large",
    } satisfies Partial<ChatRequestBodyError>);
  });

  it("uses the decompressed size rather than compressed Content-Length", async () => {
    const compressed = gzipSync("a");
    const request = new Request("http://test", {
      method: "POST",
      headers: {
        "Content-Encoding": "gzip",
        "Content-Length": String(compressed.byteLength),
      },
      body: compressed,
    });
    await expect(readChatRequestBody(request, 5)).resolves.toBe("a");
  });

  it("rejects unsupported or malformed encodings", async () => {
    await expect(
      readChatRequestBody(
        new Request("http://test", {
          method: "POST",
          headers: { "Content-Encoding": "compress" },
          body: json,
        }),
        1024,
      ),
    ).rejects.toMatchObject({ status: 415 });
    await expect(
      readChatRequestBody(
        new Request("http://test", {
          method: "POST",
          headers: { "Content-Encoding": "gzip" },
          body: "not-gzip",
        }),
        1024,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
