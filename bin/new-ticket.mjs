#!/usr/bin/env node
import { buildNewTicket, readTicket, rewriteIndex, writeTicket } from "../lib/tickets.js";
import { REPO_KEYS, TICKETS_DIR } from "../lib/paths.js";

function usage() {
  console.log(`Usage:
  dev-board new-ticket --title "Add auth smoke test" [--repo workspace] [--priority P1]
  new-ticket --title "Add auth smoke test" [--id DB-001] [--status triage]
`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  usage();
  process.exit(0);
}

const title = args.title ? String(args.title).trim() : "";
if (!title) {
  usage();
  process.exit(1);
}

const repo = args.repo || REPO_KEYS[0] || "workspace";
if (!REPO_KEYS.includes(repo)) {
  console.error(`Unknown repo "${repo}". Configured repos: ${REPO_KEYS.join(", ") || "(none)"}`);
  process.exit(1);
}

const ticket = buildNewTicket({
  id: args.id || undefined,
  title,
  status: args.status || "triage",
  priority: args.priority || "P2",
  repo,
  depends_on: args.depends_on ? String(args.depends_on).split(",").map((item) => item.trim()).filter(Boolean) : [],
  description: args.description || "",
  acceptance_criteria: args.ac ? String(args.ac).split("|").map((item) => item.trim()).filter(Boolean) : [],
  context_refs: args.context ? String(args.context).split(",").map((item) => item.trim()).filter(Boolean) : [],
});
if (readTicket(ticket.id)) {
  console.error(`Ticket already exists: ${ticket.id}`);
  process.exit(1);
}
if (args.epic) ticket.epic = args.epic;
if (args.size) ticket.size = args.size;
if (args.source) ticket.source = args.source;

writeTicket(ticket);
rewriteIndex();

console.log(`Created ${ticket.id} in ${TICKETS_DIR}`);
