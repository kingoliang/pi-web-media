// PI WEB 服务端插件：按路径读取本机的视频/音频文件，分块以 base64 返回给浏览器。
//
// 为什么分块：插件操作的结果要整块转成 JSON 经会话守护进程转发，大文件一次返回会占满内存；
// 浏览器每次取 1 MiB，自己拼起来再播放。
//
// 安全：只允许读白名单目录（settings.roots，默认见下）里、扩展名是音视频的普通文件；
// 路径先 realpath 解析软链再检查，防止 ../ 或软链跳出白名单。
import { open, realpath, stat } from "node:fs/promises";
import path from "node:path";

const DEFAULT_ROOTS = [
  "/opt/h3-hrx/out",
  "/opt/comfyui/output",
  "/home/kingo/projects",
  "/tmp",
];

const MIME = {
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".oga": "audio/ogg", ".m4a": "audio/mp4",
  ".aac": "audio/aac", ".flac": "audio/flac", ".opus": "audio/ogg",
};

const CHUNK_MAX = 1024 * 1024;          // 每次最多读 1 MiB
const FILE_MAX = 512 * 1024 * 1024;     // 单个文件上限 512 MiB

async function resolveAllowed(roots, input) {
  if (typeof input !== "string" || input.trim() === "") throw new Error("path 必须是非空字符串");
  const p = input.trim();
  if (!path.isAbsolute(p)) throw new Error(`只接受绝对路径：${p}`);
  const ext = path.extname(p).toLowerCase();
  const mime = MIME[ext];
  if (mime === undefined) throw new Error(`不支持的文件类型：${ext || "(无扩展名)"}`);
  let real;
  try { real = await realpath(p); } catch { throw new Error(`文件不存在：${p}`); }
  const ok = roots.some((root) => real === root || real.startsWith(root.endsWith("/") ? root : `${root}/`));
  if (!ok) throw new Error(`不在允许的目录里：${real}（允许：${roots.join("、")}）`);
  const st = await stat(real);
  if (!st.isFile()) throw new Error(`不是普通文件：${real}`);
  if (st.size > FILE_MAX) throw new Error(`文件太大：${st.size} 字节（上限 ${FILE_MAX}）`);
  return { real, mime, size: st.size, mtimeMs: st.mtimeMs, kind: mime.startsWith("video/") ? "video" : "audio" };
}

export default {
  apiVersion: 1,
  name: "Media",
  activate: async (context) => {
    // 白名单目录：可在 PI WEB 配置 plugins.media.settings.roots 里覆盖；先 realpath，不存在的忽略
    const configured = Array.isArray(context.settings?.roots) ? context.settings.roots.filter((r) => typeof r === "string") : DEFAULT_ROOTS;
    const roots = [];
    for (const r of configured) {
      try { roots.push(await realpath(r)); } catch { /* 目录不存在就跳过 */ }
    }
    context.logger.info(`media plugin roots: ${roots.join(", ")}`);

    return {
      operations: {
        // 输入 { path }，返回 { path, mime, kind, size, mtimeMs, chunk }
        "media.info": async (input) => {
          const info = await resolveAllowed(roots, input?.path);
          return { path: info.real, mime: info.mime, kind: info.kind, size: info.size, mtimeMs: info.mtimeMs, chunk: CHUNK_MAX };
        },
        // 输入 { path, offset, length }，返回 { offset, data(base64), eof }
        "media.read": async (input, { signal }) => {
          const info = await resolveAllowed(roots, input?.path);
          const offset = Number.isInteger(input?.offset) && input.offset >= 0 ? input.offset : 0;
          const want = Number.isInteger(input?.length) && input.length > 0 ? Math.min(input.length, CHUNK_MAX) : CHUNK_MAX;
          if (offset >= info.size) return { offset, data: "", eof: true };
          const len = Math.min(want, info.size - offset);
          const buf = Buffer.alloc(len);
          const fh = await open(info.real, "r");
          try {
            if (signal.aborted) throw new Error("aborted");
            const { bytesRead } = await fh.read(buf, 0, len, offset);
            return { offset, data: buf.subarray(0, bytesRead).toString("base64"), eof: offset + bytesRead >= info.size };
          } finally {
            await fh.close();
          }
        },
      },
      health: async () => ({ status: "healthy", details: { roots } }),
    };
  },
};
