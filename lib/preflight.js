// Cheap Haiku pre-flight triage. Before the scheduler spends a full (Sonnet/
// Opus) session on a ticket, a ~few-hundred-token Haiku pass judges whether the
// ticket is specified well enough to implement autonomously. A confident "no"
// sends it back to triage for a human to sharpen — saving a wasted full session.
//
// SAFETY: this FAILS OPEN. Any timeout, spawn error, or unparseable output is
// treated as ready:true, so a flaky pre-flight never blocks the pipeline. Only
// an explicit, confident not-ready verdict triages a ticket.
import { execFile } from "node:child_process";
import { WORKSPACE_DIR } from "./paths.js";

const TIMEOUT_MS = 60_000;
const MAX_BUFFER = 1024 * 1024;

// Verdict cache keyed by ticket id + its `updated` stamp, so an unchanged ticket
// re-seen on a later tick isn't re-assessed (no repeat Haiku spend).
const cache = new Map();

function buildPrompt(ticket) {
  const slim = {
    id: ticket.id,
    title: ticket.title,
    repo: ticket.repo,
    epic: ticket.epic,
    description: ticket.description || "",
    acceptance_criteria: Array.isArray(ticket.acceptance_criteria) ? ticket.acceptance_criteria : [],
  };
  return (
    "You are a fast triage checker for an autonomous coding pipeline. Judge ONLY " +
    "from the ticket text below — do NOT use any tools, do NOT read files. Decide " +
    "whether this ticket is specified well enough for an autonomous engineer to " +
    "implement WITHOUT a human product decision. Reply with ONLY compact JSON, no " +
    'prose, no code fences: {"ready": true|false, "reason": "<=12 words"}. ' +
    "Set ready:false ONLY if it is genuinely under-specified, self-contradictory, " +
    "or needs a product/scope decision a coder cannot make. When in doubt, " +
    "ready:true (never block borderline work). Ticket:\n" +
    JSON.stringify(slim)
  );
}

// Extract the inner verdict JSON from the CLI's `--output-format json` envelope.
function parseVerdict(stdout) {
  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    return null;
  }
  const text = typeof envelope.result === "string" ? envelope.result : "";
  // The model may wrap JSON in ``` fences or stray text — grab the first {...}.
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]);
    if (typeof v.ready !== "boolean") return null;
    return { ready: v.ready, reason: typeof v.reason === "string" ? v.reason : "" };
  } catch {
    return null;
  }
}

// Assess one ticket. Always resolves (never rejects) — returns
// { ready:boolean, reason:string, source:"haiku"|"cache"|"failopen" }.
export function assessTicket(ticket, { model = "haiku" } = {}) {
  const key = `${ticket.id}@${ticket.updated || ""}`;
  if (cache.has(key)) return Promise.resolve({ ...cache.get(key), source: "cache" });

  return new Promise((resolve) => {
    const done = (verdict) => {
      // Only cache confident machine verdicts, not fail-open fallbacks (so a
      // transient failure doesn't get pinned for the ticket's lifetime).
      if (verdict.source === "haiku") cache.set(key, { ready: verdict.ready, reason: verdict.reason });
      resolve(verdict);
    };
    let child;
    try {
      child = execFile(
        "claude",
        ["--dangerously-skip-permissions", "--model", model, "--output-format", "json", "-p", buildPrompt(ticket)],
        { cwd: WORKSPACE_DIR, timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER },
        (err, stdout) => {
          if (err) return done({ ready: true, reason: `pre-flight error (${err.code || err.message}) — fail open`, source: "failopen" });
          const v = parseVerdict(stdout || "");
          if (!v) return done({ ready: true, reason: "pre-flight unparseable — fail open", source: "failopen" });
          done({ ...v, source: "haiku" });
        }
      );
    } catch (err) {
      return done({ ready: true, reason: `pre-flight spawn failed (${err.message}) — fail open`, source: "failopen" });
    }
    if (child && child.on) child.on("error", () => {}); // swallow; callback handles it
  });
}
