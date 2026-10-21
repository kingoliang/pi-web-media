// 直接调用服务端插件的 activate 和 operations，不经过 PI WEB。
// 运行：node /opt/pi-web-media/test/server.test.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, symlink, rm, mkdir } from "node:fs/promises";
import plugin from "../server/server-plugin.js";

const logs = [];
const ctx = { settings: {}, logger: { info: (m) => logs.push(m), warn: () => {}, error: () => {}, debug: () => {} } };
const { operations } = await plugin.activate(ctx);
const sig = { signal: new AbortController().signal };
let pass = 0;
const ok = (name) => { pass += 1; console.log(`  ok  ${name}`); };
const rejects = async (p, re, name) => { await assert.rejects(p, re); ok(name); };

const video = "/opt/h3-hrx/out/fox_5s.mp4";
const audio = "/opt/h3-hrx/out/fox_5s.wav";

// 1. info
const vi = await operations["media.info"]({ path: video }, sig);
assert.equal(vi.kind, "video"); assert.equal(vi.mime, "video/mp4"); assert.ok(vi.size > 100000);
ok(`video info: ${vi.size} bytes, chunk ${vi.chunk}`);
const ai = await operations["media.info"]({ path: audio }, sig);
assert.equal(ai.kind, "audio"); assert.equal(ai.mime, "audio/wav");
ok(`audio info: ${ai.size} bytes`);

// 2. 分块读完拼起来，和原文件 sha256 一致
async function readAll(path, info) {
  const parts = []; let off = 0;
  while (off < info.size) {
    const r = await operations["media.read"]({ path, offset: off, length: info.chunk }, sig);
    const b = Buffer.from(r.data, "base64"); parts.push(b); off += b.length;
    assert.ok(JSON.stringify(r).length < 1.5 * 1024 * 1024, "单块 JSON 应小于 1.5 MiB");
    if (r.eof) break;
  }
  return Buffer.concat(parts);
}
const sha = (b) => createHash("sha256").update(b).digest("hex");
assert.equal(sha(await readAll(video, vi)), sha(await readFile(video))); ok("video 分块拼回后 sha256 一致");
assert.equal(sha(await readAll(audio, ai)), sha(await readFile(audio))); ok("audio 分块拼回后 sha256 一致");

// 3. 越界 offset
const tail = await operations["media.read"]({ path: video, offset: vi.size + 10 }, sig);
assert.equal(tail.eof, true); assert.equal(tail.data, ""); ok("offset 超过文件长度返回 eof");

// 4. 拒绝：非白名单、相对路径、../ 逃逸、非媒体扩展名、不存在、软链逃逸
await rejects(operations["media.info"]({ path: "/etc/passwd" }, sig), /不支持的文件类型/, "拒绝 /etc/passwd（扩展名）");
await rejects(operations["media.info"]({ path: "fox.mp4" }, sig), /绝对路径/, "拒绝相对路径");
await rejects(operations["media.info"]({ path: "/opt/h3-hrx/out/../../../etc/x.mp4" }, sig), /不存在|不在允许/, "拒绝 ../ 逃逸");
await rejects(operations["media.info"]({ path: "/opt/h3-hrx/out/nope.mp4" }, sig), /不存在/, "拒绝不存在的文件");
await rejects(operations["media.info"]({ path: "/home/kingo/.ssh/id_rsa.mp4" }, sig), /不存在|不在允许/, "拒绝白名单外目录");
await mkdir("/tmp/pi-web-media-test", { recursive: true });
await rm("/tmp/pi-web-media-test/evil.mp4", { force: true });
await symlink("/etc/hostname", "/tmp/pi-web-media-test/evil.mp4");
await rejects(operations["media.info"]({ path: "/tmp/pi-web-media-test/evil.mp4" }, sig), /不在允许/, "拒绝软链指向白名单外");
await rm("/tmp/pi-web-media-test", { recursive: true, force: true });
await rejects(operations["media.info"]({}, sig), /非空字符串/, "拒绝缺 path");

console.log(`\n${pass} passed. roots: ${logs.join(" | ")}`);
