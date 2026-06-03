// Learned cost model: average per-ticket token usage derived from finished
// runs in the ledger, grouped by ticket size (S/M/L) and by epic. Used by the
// Home UI to show "this ticket will probably cost ~N tokens" before launching.
//
// The headline metric is `tokens_metric` (input + output + cache-creation
// tokens), the same field runs.js stores per run. Cache reads are excluded
// because they're cheap and noisy.
//
// Everything degrades gracefully: with no data, estimateTicketTokens() returns
// DEFAULT_TICKET_TOKENS. The fallback chain is size -> epic -> global -> default.

import { getRuns } from "./runs.js";
import { readTicket } from "./tickets.js";

// Configurable default when the ledger has no usable signal yet.
export const DEFAULT_TICKET_TOKENS = 40000;

function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function avg(values) {
  if (!values.length) return null;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return Math.round(sum / values.length);
}

// A run contributes a data point only if it actually finished and we parsed a
// positive token metric for it.
function runMetric(run) {
  const metric = num(run && run.tokens_metric);
  if (metric > 0) return metric;
  // Older records may only carry the nested tokens object.
  if (run && run.tokens) return num(run.tokens.tokens_metric);
  return 0;
}

function isFinished(run) {
  return run && run.status && run.status !== "running";
}

// Build the learned model from the ledger. Joins each finished run back to its
// ticket to recover size + epic (those aren't stored on the run record).
// Returns grouped averages plus the global average and sample counts, suitable
// for both estimateTicketTokens() and direct display in the Home UI.
export function buildCostModel(options = {}) {
  const runs = typeof options.runs === "undefined" ? getRuns() : options.runs;
  const lookupTicket =
    typeof options.readTicket === "function" ? options.readTicket : readTicket;

  const bySize = {}; // size -> number[]
  const byEpic = {}; // epic -> number[]
  const global = [];

  for (const run of runs) {
    if (!isFinished(run)) continue;
    const metric = runMetric(run);
    if (metric <= 0) continue;

    global.push(metric);

    const ticket = run.ticket_id ? lookupTicket(run.ticket_id) : null;
    const size = ticket && ticket.size ? String(ticket.size) : null;
    const epic = ticket && ticket.epic ? String(ticket.epic) : null;

    if (size) (bySize[size] ||= []).push(metric);
    if (epic) (byEpic[epic] ||= []).push(metric);
  }

  const sizeAverages = {};
  for (const [size, values] of Object.entries(bySize)) {
    sizeAverages[size] = { avg: avg(values), samples: values.length };
  }
  const epicAverages = {};
  for (const [epic, values] of Object.entries(byEpic)) {
    epicAverages[epic] = { avg: avg(values), samples: values.length };
  }

  return {
    metric: "tokens_metric",
    default: DEFAULT_TICKET_TOKENS,
    bySize: sizeAverages,
    byEpic: epicAverages,
    global: { avg: avg(global), samples: global.length },
  };
}

// Best available average token estimate for a ticket.
// Fallback chain: size average -> epic average -> global average -> default.
// Accepts either a ticket object or a ticket id; pass a prebuilt `model` to
// avoid re-reading the ledger per ticket.
export function estimateTicketTokens(ticket, options = {}) {
  const model = options.model || buildCostModel(options);

  let t = ticket;
  if (typeof ticket === "string") {
    const lookup =
      typeof options.readTicket === "function" ? options.readTicket : readTicket;
    t = lookup(ticket);
  }
  const size = t && t.size ? String(t.size) : null;
  const epic = t && t.epic ? String(t.epic) : null;

  if (size && model.bySize[size] && model.bySize[size].avg) {
    return {
      tokens: model.bySize[size].avg,
      basis: "size",
      key: size,
      samples: model.bySize[size].samples,
    };
  }
  if (epic && model.byEpic[epic] && model.byEpic[epic].avg) {
    return {
      tokens: model.byEpic[epic].avg,
      basis: "epic",
      key: epic,
      samples: model.byEpic[epic].samples,
    };
  }
  if (model.global && model.global.avg) {
    return {
      tokens: model.global.avg,
      basis: "global",
      key: null,
      samples: model.global.samples,
    };
  }
  return { tokens: model.default, basis: "default", key: null, samples: 0 };
}
