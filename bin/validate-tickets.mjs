#!/usr/bin/env node
import fs from "node:fs";
import { readAllTickets, rewriteIndex } from "../lib/tickets.js";
import {
  validateDependencyGraph,
  validateIndex,
  validateTicketSemantics,
  validateTicketShape,
} from "../lib/validation.js";
import { TICKETS_INDEX } from "../lib/paths.js";

const args = new Set(process.argv.slice(2));
const fix = args.has("--fix");

function readIndex() {
  try {
    return JSON.parse(fs.readFileSync(TICKETS_INDEX, "utf8"));
  } catch {
    return [];
  }
}

function printIssue(ticketId, item) {
  const target = ticketId ? `${ticketId}: ` : "";
  console.log(`${item.level.toUpperCase()} ${target}${item.code} - ${item.message}`);
}

const tickets = readAllTickets();
const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
let issues = [];

for (const ticket of tickets) {
  issues.push(...validateTicketShape(ticket).map((item) => ({ ticket: ticket.id, ...item })));
  issues.push(...validateTicketSemantics(ticket, byId).map((item) => ({ ticket: ticket.id, ...item })));
}

issues.push(...validateDependencyGraph(tickets).map((item) => ({ ticket: null, ...item })));

let indexIssues = validateIndex(tickets, readIndex()).map((item) => ({ ticket: null, ...item }));
if (fix && indexIssues.some((item) => item.code === "index_drift")) {
  rewriteIndex();
  indexIssues = [];
  console.log(`FIXED _index.json`);
}
issues.push(...indexIssues);

for (const item of issues) printIssue(item.ticket, item);

const errors = issues.filter((item) => item.level === "error");
const warnings = issues.filter((item) => item.level === "warning");
console.log(`Validated ${tickets.length} ticket(s): ${errors.length} error(s), ${warnings.length} warning(s).`);

process.exit(errors.length ? 1 : 0);
