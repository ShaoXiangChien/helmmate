// Read/resolve the memory sync-queue (memory/sync-queue/*.md). Autonomous ticket
// sessions drop proposed memory updates here; the Agents tab surfaces them for review. We never
// auto-apply a proposal to curated memory — "resolve" only archives (you applied
// it by hand) or dismisses (you skipped it). That keeps the human review gate.
import fs from "node:fs";
import path from "node:path";
import { MEMORY_QUEUE_DIR } from "./paths.js";

const QUEUE_DIR = MEMORY_QUEUE_DIR;
const APPLIED_DIR = path.join(QUEUE_DIR, "applied");

// Files that are scaffolding, not proposals.
const RESERVED = new Set(["README.md", "TEMPLATE.md"]);

// Proposal ids are ticket-like (DB-070) or other safe slugs — no path bits.
const ID_RE = /^[A-Za-z0-9._-]+$/;
export function isValidQueueId(id) {
  return typeof id === "string" && ID_RE.test(id) && !id.includes("..");
}

function fileFor(id) {
  return path.join(QUEUE_DIR, `${id}.md`);
}

// Pending proposals, newest first. Each carries the raw content so the UI can
// render it inline without a second request.
export function listQueue() {
  let files;
  try {
    files = fs.readdirSync(QUEUE_DIR);
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    if (!f.endsWith(".md") || RESERVED.has(f)) continue;
    const full = path.join(QUEUE_DIR, f);
    let stat, content;
    try {
      stat = fs.statSync(full);
      if (!stat.isFile()) continue; // skip the applied/ dir etc.
      content = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    const proposalCount = (content.match(/^##\s+Proposal/gim) || []).length;
    out.push({
      id: f.slice(0, -3),
      file: full,
      mtime: stat.mtimeMs,
      proposalCount,
      content,
    });
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

export function queueCount() {
  return listQueue().length;
}

// Resolve a pending proposal file. action="archive" moves it to
// sync-queue/applied/ (you applied it); action="dismiss" deletes it (you
// skipped it). Returns { ok, error? }.
export function resolveQueueItem(id, action) {
  if (!isValidQueueId(id)) return { ok: false, error: "invalid id" };
  const src = fileFor(id);
  if (!fs.existsSync(src)) return { ok: false, error: "not found" };
  try {
    if (action === "dismiss") {
      fs.unlinkSync(src);
      return { ok: true, action };
    }
    if (action === "archive") {
      fs.mkdirSync(APPLIED_DIR, { recursive: true });
      // Timestamp-prefix so re-applied ids don't collide. mtime as the stamp
      // keeps it deterministic-ish without Date.now() concerns here.
      const stamp = Math.round(fs.statSync(src).mtimeMs);
      fs.renameSync(src, path.join(APPLIED_DIR, `${stamp}-${id}.md`));
      return { ok: true, action };
    }
    return { ok: false, error: "unknown action" };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
