// Read/parse/write the configured role persona files.
// These are the source of truth for the autonomous-session roles (Phase 1):
// YAML-ish frontmatter (name, description, model) + a markdown persona body.
// The Agents tab (Phase 2) lists and edits them through GET/PUT /api/agents;
// roles.js reads the `model` frontmatter here so the model is defined in ONE
// place (edit the file → launcher, scheduler gate, and UI all agree).
import fs from "node:fs";
import path from "node:path";
import { AGENTS_DIR } from "./paths.js";

// Safe role/filename: lowercase letters, digits, hyphens.
const ROLE_RE = /^[a-z0-9][a-z0-9-]*$/;
export function isValidRole(role) {
  return typeof role === "string" && ROLE_RE.test(role) && !role.includes("..");
}

// Model must be a short single-line token (alias like sonnet/opus/haiku, or a
// full model name). No newlines/quotes that would break the frontmatter.
const MODEL_RE = /^[A-Za-z0-9._\-\[\]]+$/;
export function isValidModel(model) {
  return typeof model === "string" && MODEL_RE.test(model);
}

export function agentPath(role) {
  return path.join(AGENTS_DIR, `${role}.md`);
}

// Split a persona file into { frontmatter:{...}, body } tolerantly. A file with
// no leading `---` block is treated as all-body with empty frontmatter.
export function parseAgentFile(text) {
  const fm = {};
  let body = text || "";
  if (/^---\s*\n/.test(body)) {
    const end = body.indexOf("\n---", 3);
    if (end !== -1) {
      const block = body.slice(body.indexOf("\n") + 1, end);
      // body picks up after the closing --- line.
      const after = body.indexOf("\n", end + 1);
      body = after === -1 ? "" : body.slice(after + 1);
      for (const line of block.split("\n")) {
        const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (m) fm[m[1]] = m[2].trim();
      }
    }
  }
  return { frontmatter: fm, body: body.replace(/^\n+/, "") };
}

function toAgent(role, text) {
  const { frontmatter, body } = parseAgentFile(text);
  return {
    role,
    name: frontmatter.name || role,
    description: frontmatter.description || "",
    model: frontmatter.model || "",
    body,
    path: agentPath(role),
    exists: true,
  };
}

export function listAgents() {
  let files;
  try {
    files = fs.readdirSync(AGENTS_DIR);
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    if (!f.endsWith(".md")) continue;
    const role = f.slice(0, -3);
    try {
      out.push(toAgent(role, fs.readFileSync(path.join(AGENTS_DIR, f), "utf8")));
    } catch {
      /* skip unreadable */
    }
  }
  out.sort((a, b) => a.role.localeCompare(b.role));
  return out;
}

export function listConfiguredAgents(roleConfig = {}) {
  const configuredRoles = Object.keys(roleConfig || {}).filter(isValidRole);
  const existing = new Map(listAgents().map((agent) => [agent.role, agent]));
  const roles = [...new Set([...configuredRoles, ...existing.keys()])].sort((a, b) => a.localeCompare(b));
  return roles.map((role) => {
    const agent = existing.get(role);
    if (agent) {
      return {
        ...agent,
        configuredModel: roleConfig[role] && roleConfig[role].model ? String(roleConfig[role].model) : "",
      };
    }
    return {
      role,
      name: role,
      description: "",
      model: "",
      configuredModel: roleConfig[role] && roleConfig[role].model ? String(roleConfig[role].model) : "",
      body: "",
      path: agentPath(role),
      exists: false,
    };
  });
}

export function readAgent(role) {
  if (!isValidRole(role)) return null;
  try {
    return toAgent(role, fs.readFileSync(agentPath(role), "utf8"));
  } catch {
    return null;
  }
}

// The model pinned in a role's frontmatter (or null if no file / no model).
// roles.js uses this so the persona file is the single source of truth.
export function readAgentModel(role) {
  const a = readAgent(role);
  return a && a.model ? a.model : null;
}

// Reconstruct + write a persona file from edited fields, preserving the
// frontmatter shape (name, description, model) then the body. Only updates the
// fields provided; refuses invalid role/model. Returns { ok, agent?, error? }.
export function writeAgent(role, { name, description, model, body } = {}) {
  if (!isValidRole(role)) return { ok: false, error: "invalid role" };
  const existing = readAgent(role);
  if (!existing) return { ok: false, error: "agent not found" };
  const next = {
    name: (name != null ? String(name) : existing.name) || role,
    description: description != null ? String(description) : existing.description,
    model: (model != null ? String(model) : existing.model) || existing.model,
    body: body != null ? String(body) : existing.body,
  };
  if (!isValidModel(next.model)) return { ok: false, error: "invalid model" };
  // Keep frontmatter values single-line (strip CR/LF) so the block stays valid.
  const oneLine = (s) => String(s).replace(/[\r\n]+/g, " ").trim();
  const fm = [
    "---",
    `name: ${oneLine(next.name)}`,
    `description: ${oneLine(next.description)}`,
    `model: ${oneLine(next.model)}`,
    "---",
    "",
  ].join("\n");
  const content = fm + next.body.replace(/^\n+/, "").replace(/\s*$/, "") + "\n";
  try {
    fs.writeFileSync(agentPath(role), content);
  } catch (err) {
    return { ok: false, error: `write failed: ${err.message}` };
  }
  return { ok: true, agent: readAgent(role) };
}
