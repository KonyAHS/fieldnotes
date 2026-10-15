// Attachment files (tickets, confirmations). Each file is stored under its
// attachment ID with a small metadata file beside it; plans refer to files by
// ID in the workspace. Files no plan refers to are removed after a grace
// period, so a device that added a file offline has time to sync its plan.
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { maxAttachmentBytes } from "../src/model.ts";
type Meta = { name: string; type: string; size: number; created: string };
export const validId = (id: string) => /^[\w-]{8,64}$/.test(id);
// Types that are safe to show inline; anything else is served as a download.
const inline = /^(image\/(png|jpeg|gif|webp|heic|heif|avif)|application\/pdf|text\/plain)$/;
export function attachments(dataDir: string) {
  const dir = join(dataDir, "attachments");
  mkdirSync(dir, { recursive: true });
  const file = (id: string) => join(dir, id);
  const metaFile = (id: string) => join(dir, id + ".json");
  const meta = (id: string): Meta | null => {
    try {
      return JSON.parse(readFileSync(metaFile(id), "utf8"));
    } catch {
      return null;
    }
  };
  return {
    has: (id: string) => existsSync(file(id)) && existsSync(metaFile(id)),
    async save(id: string, req: IncomingMessage) {
      const type = String(req.headers["content-type"] || "")
        .split(";")[0]
        .trim()
        .toLowerCase()
        .slice(0, 100);
      let name = "attachment";
      try {
        name = decodeURIComponent(String(req.headers["x-file-name"] || ""));
      } catch {}
      name = name.replace(/[\u0000-\u001f/\\]/g, "").slice(0, 300) || "attachment";
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > maxAttachmentBytes) return "too-large" as const;
        chunks.push(chunk);
      }
      // Write to a temporary name first so a half-written file is never served.
      const temp = file(id) + ".part";
      writeFileSync(temp, Buffer.concat(chunks));
      writeFileSync(
        metaFile(id),
        JSON.stringify({
          name,
          type: type || "application/octet-stream",
          size,
          created: new Date().toISOString(),
        } satisfies Meta),
      );
      renameSync(temp, file(id));
      return "saved" as const;
    },
    send(id: string, req: IncomingMessage, res: ServerResponse) {
      const m = meta(id);
      if (!m || !existsSync(file(id))) return false;
      const safe = inline.test(m.type);
      res.writeHead(200, {
        "Content-Type": safe ? m.type : "application/octet-stream",
        "Content-Length": String(statSync(file(id)).size),
        "Content-Disposition": `${safe ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(m.name)}`,
        // Files never change under the same ID.
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
      });
      if (req.method === "HEAD") res.end();
      else createReadStream(file(id)).pipe(res);
      return true;
    },
    remove(id: string) {
      rmSync(file(id), { force: true });
      rmSync(metaFile(id), { force: true });
    },
    // Remove files no plan has referred to for `graceDays`.
    sweep(referenced: Set<string>, graceDays = 30) {
      const cutoff = Date.now() - graceDays * 86400000;
      for (const name of readdirSync(dir)) {
        const id = name.replace(/\.(json|part)$/, "");
        if (referenced.has(id)) continue;
        const path = join(dir, name);
        if (statSync(path).mtimeMs < cutoff) rmSync(path, { force: true });
      }
    },
  };
}
