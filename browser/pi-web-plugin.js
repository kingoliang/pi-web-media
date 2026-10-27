// PI WEB 浏览器端插件：把聊天里的 ```video / ```audio 代码块渲染成播放器，```image 渲染成图片。
//
// 用法（agent 或用户在回复里写）：
//   ```video
//   /opt/h3-hrx/out/fox_5s.mp4
//   ```
// 代码块里写本机文件的绝对路径（一行一个，可以写多个）。```audio、```image 同理。
// 文件由本插件的服务端分块读出（只允许白名单目录），在浏览器里拼成 Blob 播放，所以不经过 Files 面板。
// 渲染失败时抛错，PI WEB 会保留原来的代码块。

const CACHE_MAX = 24;
const cache = new Map(); // key: path|mtime -> Promise<{ url, info }>

function remember(key, value) {
  cache.set(key, value);
  while (cache.size > CACHE_MAX) {
    const [oldKey, oldVal] = cache.entries().next().value;
    cache.delete(oldKey);
    oldVal.then((v) => URL.revokeObjectURL(v.url)).catch(() => {});
  }
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function humanSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHUNK_TRIES = 3; // 单块读失败自动重试几次（大文件偶发超时时不至于整个失败）

// 未读完的文件：路径|mtime -> { info, parts, offset }。重试时从上次读到的位置接着读，不从头来。
const partial = new Map();

async function withRetry(fn) {
  let last;
  for (let i = 0; i < CHUNK_TRIES; i += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (i + 1 < CHUNK_TRIES) await sleep(1000 * 2 ** i);
    }
  }
  throw last;
}

async function loadBlob(callOperation, path, onProgress) {
  const info = await withRetry(() => callOperation("media.info", { path }));
  const key = `${info.path}|${info.mtimeMs}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const job = (async () => {
    const st = partial.get(key) ?? { parts: [], offset: 0 };
    partial.set(key, st);
    while (st.offset < info.size) {
      const r = await withRetry(() => callOperation("media.read", { path: info.path, offset: st.offset, length: info.chunk }));
      const bytes = b64ToBytes(r.data);
      if (bytes.length === 0) break;
      st.parts.push(bytes);
      st.offset += bytes.length;
      onProgress(st.offset, info.size);
      if (r.eof) break;
    }
    partial.delete(key);
    const url = URL.createObjectURL(new Blob(st.parts, { type: info.mime }));
    return { url, info };
  })();
  remember(key, job);
  job.catch(() => cache.delete(key));
  return job;
}

function el(tag, style, text) {
  const e = document.createElement(tag);
  if (style) e.style.cssText = style;
  if (text !== undefined) e.textContent = text;
  return e;
}

function makeRenderer(kind, getCall) {
  return async (source) => {
    const callOperation = getCall();
    if (typeof callOperation !== "function") throw new Error("This PI WEB cannot call plugin operations");
    const paths = source.split("\n").map((s) => s.trim()).filter((s) => s !== "" && !s.startsWith("#"));
    if (paths.length === 0) throw new Error(`Empty ${kind} fence`);

    const root = el("div", "display:flex;flex-direction:column;align-items:flex-start;gap:12px;margin:0;width:100%;max-width:100%;min-width:0;box-sizing:border-box");
    root.className = "pi-web-media";
    for (const path of paths) {
      const box = el("figure", "margin:0;display:flex;flex-direction:column;gap:4px");
      const status = el("figcaption", "font-size:12px;opacity:.75;word-break:break-all", `正在加载 ${path} …`);
      box.append(status);
      root.append(box);

      const load = () => loadBlob(callOperation, path, (done, total) => {
        status.textContent = `正在加载 ${path} … ${Math.floor((done / total) * 100)}%`;
      }).then(({ url, info }) => {
        const name = info.path.split("/").pop();
        if (info.kind === "image") {
          // 图片：最宽 720px、最高 70vh，保持比例；点击在新标签页看原图
          const MAX_IMG_W = "720px";
          box.style.setProperty("width", "100%", "important");
          box.style.setProperty("max-width", MAX_IMG_W, "important");
          box.style.setProperty("min-width", "0", "important");
          box.style.setProperty("box-sizing", "border-box", "important");
          const img = document.createElement("img");
          img.src = url;
          img.alt = name;
          img.loading = "lazy";
          img.style.setProperty("display", "block");
          img.style.setProperty("max-width", "100%", "important");
          img.style.setProperty("max-height", "70vh", "important");
          img.style.setProperty("width", "auto", "important");
          img.style.setProperty("height", "auto", "important");
          img.style.setProperty("object-fit", "contain");
          img.style.setProperty("border-radius", "6px");
          img.style.setProperty("cursor", "zoom-in");
          const open = el("a", "display:block;line-height:0");
          open.href = url;
          open.target = "_blank";
          open.rel = "noopener";
          open.append(img);
          const link = el("a", "color:inherit", "下载");
          link.href = url;
          link.download = name;
          status.textContent = `${name} · ${humanSize(info.size)} · `;
          status.append(link);
          box.insertBefore(open, status);
          return;
        }
        const player = document.createElement(info.kind === "video" ? "video" : "audio");
        player.controls = true;
        player.preload = "metadata";
        player.src = url;
        // 宽度取「可用宽度」和 480px 里较小的那个：电脑上最宽 480px，手机上不超出屏幕。
        // width:100% + max-width:480px 就是 min(父容器宽度, 480px)；min-width:0 防止 flex 子项按内容撑宽。
        // 用 setProperty(..., "important")，防止聊天区的样式把它撑满。要看大图用播放器自带的全屏按钮。
        const MAX_W = "480px";
        box.style.setProperty("width", "100%", "important");
        box.style.setProperty("max-width", MAX_W, "important");
        box.style.setProperty("min-width", "0", "important");
        box.style.setProperty("box-sizing", "border-box", "important");
        player.style.setProperty("width", "100%", "important");
        player.style.setProperty("max-width", MAX_W, "important");
        if (info.kind === "video") {
          player.style.setProperty("max-height", "40vh", "important");
          player.style.setProperty("height", "auto", "important");
          player.style.setProperty("border-radius", "6px");
          player.style.setProperty("background", "#000");
        }
        if (info.kind === "video") player.playsInline = true;
        const link = el("a", "color:inherit", "下载");
        link.href = url;
        link.download = name;
        status.textContent = `${name} · ${humanSize(info.size)} · `;
        status.append(link);
        box.insertBefore(player, status);
      }).catch((err) => {
        status.textContent = `无法加载 ${path}：${err instanceof Error ? err.message : String(err)} `;
        status.style.color = "var(--pi-danger, #c33)";
        status.style.opacity = "1";
        // 重试按钮：从上次读到的块接着读
        const retry = el("button", "margin-left:6px;padding:1px 10px;font-size:12px;border-radius:4px;border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer", "重试");
        retry.type = "button";
        retry.addEventListener("click", () => {
          retry.remove();
          status.style.color = "";
          status.style.opacity = ".75";
          status.textContent = `正在重试 ${path} …`;
          load();
        });
        status.append(retry);
      });
      load();
    }
    return root;
  };
}

const plugin = {
  apiVersion: 2,
  name: "Media Player",
  activate: (context) => {
    // 渲染函数里只拿得到代码块文本，所以把 callOperation 闭包进去
    const getCall = () => context.callOperation;
    return {
      contributions: {
        codeFenceRenderers: [
          { id: "video", language: "video", render: makeRenderer("video", getCall) },
          { id: "audio", language: "audio", render: makeRenderer("audio", getCall) },
          { id: "image", language: "image", render: makeRenderer("image", getCall) },
        ],
      },
      dispose: () => {
        for (const job of cache.values()) job.then((v) => URL.revokeObjectURL(v.url)).catch(() => {});
        cache.clear();
      },
    };
  },
};

export default plugin;
