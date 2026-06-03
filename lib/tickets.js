// Reading/writing ticket JSON files and the _index.json rollup.
import fs from "node:fs";
import path from "node:path";
import { REPO_KEYS, TICKET_ID_PREFIX, TICKETS_DIR, TICKETS_INDEX } from "./paths.js";

// Path-traversal guard for :id. Allows dotted child ids (e.g. DB-001.1) while
// still rejecting anything with a slash or a ".." sequence.
const ID_RE = /^[A-Za-z0-9._-]+$/;

export function isValidId(id) {
  return typeof id === "string" && ID_RE.test(id) && !id.includes("..");
}

function ticketPath(id) {
  return path.join(TICKETS_DIR, `${id}.json`);
}

// Read every tickets/*.json (excluding _index.json). Robust to missing dir
// and to individual malformed files (those are skipped with a warning).
export function readAllTickets() {
  let files;
  try {
    files = fs.readdirSync(TICKETS_DIR);
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    console.error("[tickets] cannot read tickets dir:", err.message);
    return [];
  }
  const out = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    if (f === "_index.json") continue;
    try {
      const raw = fs.readFileSync(path.join(TICKETS_DIR, f), "utf8");
      out.push(JSON.parse(raw));
    } catch (err) {
      console.error(`[tickets] skipping malformed ${f}:`, err.message);
    }
  }
  out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return out;
}

export function readTicket(id) {
  if (!isValidId(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(ticketPath(id), "utf8"));
  } catch {
    return null;
  }
}

export function writeTicket(ticket) {
  fs.mkdirSync(TICKETS_DIR, { recursive: true });
  fs.writeFileSync(ticketPath(ticket.id), JSON.stringify(ticket, null, 2) + "\n");
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function slug(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .slice(0, 6)
    .join("-");
}

export function nextTicketId(prefix = TICKET_ID_PREFIX) {
  const re = new RegExp(`^${escapeRe(prefix)}-(\\d+)$`);
  let max = 0;
  for (const ticket of readAllTickets()) {
    const m = String(ticket.id || "").match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

export function buildNewTicket({
  id,
  title,
  repo,
  priority = "P2",
  status = "triage",
  description = "",
  acceptance_criteria = [],
  context_refs = [],
  depends_on = [],
} = {}) {
  const cleanTitle = String(title || "").trim();
  const ticketId = id || nextTicketId();
  const targetRepo = repo || REPO_KEYS[0] || "workspace";
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: ticketId,
    title: cleanTitle,
    epic: "",
    status,
    priority,
    repo: targetRepo,
    depends_on: Array.isArray(depends_on) ? depends_on : [],
    size: "",
    description,
    acceptance_criteria: Array.isArray(acceptance_criteria) ? acceptance_criteria : [],
    context_refs: Array.isArray(context_refs) ? context_refs : [],
    branch: `ticket/${ticketId}-${slug(cleanTitle)}`.replace(/-$/, ""),
    pr_url: "",
    source: "manual",
    created: today,
    updated: today,
    notes: [],
  };
}

// Rebuild _index.json from the full ticket set, preserving the slim shape.
export function rewriteIndex() {
  const tickets = readAllTickets();
  const slim = tickets.map((t) => ({
    id: t.id,
    title: t.title,
    epic: t.epic,
    status: t.status,
    priority: t.priority,
    repo: t.repo,
    depends_on: Array.isArray(t.depends_on) ? t.depends_on : [],
    origin: t.origin ?? null,
  }));
  try {
    fs.mkdirSync(TICKETS_DIR, { recursive: true });
    fs.writeFileSync(TICKETS_INDEX, JSON.stringify(slim, null, 2) + "\n");
  } catch (err) {
    console.error("[tickets] failed to rewrite index:", err.message);
  }
  return slim;
}

// True when every id in depends_on resolves to a ticket with status "done".
export function depsSatisfied(ticket, allById) {
  const deps = Array.isArray(ticket.depends_on) ? ticket.depends_on : [];
  return deps.every((depId) => {
    const dep = allById ? allById.get(depId) : readTicket(depId);
    return dep && dep.status === "done";
  });
}

export function ticketsById() {
  const map = new Map();
  for (const t of readAllTickets()) map.set(t.id, t);
  return map;
}
