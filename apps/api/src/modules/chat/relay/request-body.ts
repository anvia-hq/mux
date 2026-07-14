import { Readable, type Transform } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

export class ChatRequestBodyError extends Error {
  readonly status: 400 | 413 | 415;
  readonly code: string;

  constructor(message: string, status: 400 | 413 | 415, code: string) {
    super(message);
    this.name = "ChatRequestBodyError";
    this.status = status;
    this.code = code;
  }
}

function decompressor(encoding: string): Transform | null {
  if (encoding === "gzip") return createGunzip();
  if (encoding === "deflate") return createInflate();
  if (encoding === "br") return createBrotliDecompress();
  return null;
}

async function readLimited(
  stream: AsyncIterable<Uint8Array | Buffer>,
  limit: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > limit) {
      throw new ChatRequestBodyError("request body too large", 413, "request_body_too_large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, size);
}

export async function readChatRequestBody(request: Request, limit: number): Promise<string> {
  const encoding = (request.headers.get("content-encoding") ?? "identity").trim().toLowerCase();
  if (!["identity", "gzip", "deflate", "br"].includes(encoding)) {
    throw new ChatRequestBodyError(
      `unsupported content encoding: ${encoding}`,
      415,
      "unsupported_content_encoding",
    );
  }
  const contentLength = request.headers.get("content-length");
  if (encoding === "identity" && contentLength && Number(contentLength) > limit) {
    throw new ChatRequestBodyError("request body too large", 413, "request_body_too_large");
  }
  if (!request.body) return "";

  try {
    const input = Readable.fromWeb(request.body as never);
    const transform = decompressor(encoding);
    const decoded = transform ? input.pipe(transform) : input;
    return (await readLimited(decoded, limit)).toString("utf8");
  } catch (error) {
    if (error instanceof ChatRequestBodyError) throw error;
    throw new ChatRequestBodyError("invalid compressed request body", 400, "bad_request_body");
  }
}
