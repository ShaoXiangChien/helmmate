// HelmMate Home view — vanilla JS. Tab shell + live ops dashboard.
// Owns: tab switching (Home | Board), localStorage tab memory, and the
// Home dashboard which polls /api/setup/status, /api/config, /api/state,
// /api/usage, /api/scheduler, /api/runs, and /api/tickets.
// Does NOT touch board.js state — only reads its own endpoints.

(function () {
  "use strict";

  const POLL_MS = 10000;
  const TAB_KEY = "helmmate.activeTab";

  const home = {
    visible: false,
    timer: null,
    countdownTimer: null,
    setup: null,
    config: null,
    state: null,
    usage: null,
    scheduler: null,
    runs: null,
    tickets: null,
    // Captured at last /api/usage poll so the countdown can tick locally.
    resetAt: null, // ms epoch
  };

  const $ = (sel) => document.querySelector(sel);

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---------- formatting helpers (tolerant of missing data) ----------
  function num(n) {
    if (n == null || Number.isNaN(Number(n))) return null;
    return Number(n);
  }

  function fmtInt(n) {
    const v = num(n);
    if (v == null) return "—";
    return Math.round(v).toLocaleString("en-US");
  }

  function fmtTokens(n) {
    const v = num(n);
    if (v == null) return "—";
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1) + "M";
    if (v >= 1_000) return (v / 1_000).toFixed(v >= 10_000 ? 0 : 1) + "k";
    return String(Math.round(v));
  }

  function fmtPct(p) {
    const v = num(p);
    if (v == null) return "—";
    return Math.round(v) + "%";
  }

  function fmtFractionPct(p) {
    const v = num(p);
    if (v == null) return "—";
    return fmtPct(v * 100);
  }

  function fmtUSD(n) {
    const v = num(n);
    if (v == null) return "—";
    return "$" + v.toFixed(v >= 100 ? 0 : 2);
  }

  function fmtMin(n) {
    const v = num(n);
    if (v == null) return "—";
    if (v < 1) return "<1m";
    if (v < 60) return Math.round(v) + "m";
    const h = Math.floor(v / 60);
    const m = Math.round(v % 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  function fmtDuration(startISO, endISO) {
    const s = startISO ? Date.parse(startISO) : NaN;
    const e = endISO ? Date.parse(endISO) : Date.now();
    if (Number.isNaN(s)) return "—";
    const secs = Math.max(0, Math.round((e - s) / 1000));
    if (secs < 60) return secs + "s";
    const m = Math.floor(secs / 60);
    const r = secs % 60;
    if (m < 60) return r ? `${m}m ${r}s` : `${m}m`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }

  function fmtClock(ms) {
    if (ms == null || Number.isNaN(ms)) return "—";
    const total = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  function relTime(iso) {
    if (!iso) return "—";
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return "—";
    const diff = Date.now() - t;
    const s = Math.round(diff / 1000);
    if (s < 60) return s + "s ago";
    const m = Math.round(s / 60);
    if (m < 60) return m + "m ago";
    const h = Math.round(m / 60);
    if (h < 24) return h + "h ago";
    return Math.round(h / 24) + "d ago";
  }

  function untilTime(iso) {
    if (!iso) return "—";
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return "—";
    const diff = t - Date.now();
    if (diff <= 0) return "now";
    return fmtClock(diff);
  }

  // ---------- data ----------
  async function getJSON(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async function poll() {
    const [setup, config, state, scheduler, runs, tickets] = await Promise.all([
      getJSON("/api/setup/status"),
      getJSON("/api/config"),
      getJSON("/api/state"),
      getJSON("/api/scheduler"),
      getJSON("/api/runs"),
      getJSON("/api/tickets"),
    ]);
    home.setup = setup;
    home.config = config;
    home.state = state;
    home.scheduler = scheduler;
    home.runs = Array.isArray(runs) ? runs : runs == null ? null : [];
    home.tickets = Array.isArray(tickets) ? tickets : tickets == null ? null : [];
    render();

    const usage = await getJSON("/api/usage");
    home.usage = usage;

    // Anchor the live countdown to a real timestamp if we have one.
    const block = usage && usage.block ? usage.block : null;
    if (block && block.resetTime) {
      const t = Date.parse(block.resetTime);
      home.resetAt = Number.isNaN(t) ? null : t;
    } else if (block && num(block.minutesRemaining) != null) {
      home.resetAt = Date.now() + num(block.minutesRemaining) * 60000;
    } else {
      home.resetAt = null;
    }

    render();
  }

  async function toggleAutopilot() {
    const cur = home.scheduler && home.scheduler.autopilot;
    const next = !cur;
    // Optimistic.
    if (home.scheduler) home.scheduler.autopilot = next;
    render();
    try {
      const res = await fetch("/api/autopilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on: next }),
      });
      if (res.ok) {
        home.scheduler = await res.json();
      } else if (home.scheduler) {
        home.scheduler.autopilot = cur; // revert
      }
    } catch {
      if (home.scheduler) home.scheduler.autopilot = cur;
    }
    render();
  }

  async function resetBreaker() {
    try {
      const res = await fetch("/api/breaker/reset", { method: "POST" });
      if (res.ok) home.scheduler = await res.json();
    } catch {
      /* leave as-is */
    }
    render();
  }

  async function initializeFolders(btn) {
    if (btn) btn.disabled = true;
    try {
      await fetch("/api/setup/init", { method: "POST" });
    } catch {
      /* refresh will show the effective state */
    }
    await poll();
    if (btn) btn.disabled = false;
  }

  async function createStarterTicket(btn) {
    if (btn) btn.disabled = true;
    const repo = (home.setup && Array.isArray(home.setup.repos) && home.setup.repos[0])
      || (home.config && Array.isArray(home.config.repos) && home.config.repos[0])
      || "workspace";
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "First HelmMate ticket",
          repo,
          priority: "P2",
          status: "triage",
          description: "Created from the Home readiness checklist.",
          acceptance_criteria: ["Ticket appears on the board"],
        }),
      });
      if (res.ok && window.helmmateSetView) window.helmmateSetView("board");
    } catch {
      /* keep Home calm; the checklist will stay on the current step */
    }
    await poll();
    if (btn) btn.disabled = false;
  }

  async function setArmed(armed, btn) {
    if (btn) btn.disabled = true;
    try {
      const res = await fetch("/api/arm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ armed: !!armed }),
      });
      if (res.ok) home.state = await res.json();
    } catch {
      /* leave as-is */
    }
    await poll();
    if (btn) btn.disabled = false;
  }

  // Manually dispatch a CI-fix / conflict-fix for a PR (button in CI Watch).
  async function dispatchTicketFix(ticket, kind, pr, btn) {
    if (!ticket) return;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "dispatching…";
    }
    try {
      const payload = {};
      if (kind) payload.kind = kind;
      if (pr) payload.pr = pr;
      const res = await fetch(`/api/tickets/${encodeURIComponent(ticket)}/fix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok && btn) {
        const e = await res.json().catch(() => ({}));
        btn.textContent = `refused: ${e.reason || res.status}`;
      }
    } catch {
      if (btn) btn.textContent = "error";
    }
    poll(); // refresh so "fix sent" / running reflects immediately
  }

  // ---------- render ----------
  function card(title, bodyHtml, opts = {}) {
    const accent = opts.accentClass ? ` ${opts.accentClass}` : "";
    const sub = opts.sub ? `<span class="home-card-sub">${esc(opts.sub)}</span>` : "";
    return `
      <section class="home-card${accent}">
        <div class="home-card-head">
          <h3>${esc(title)}</h3>
          ${sub}
        </div>
        <div class="home-card-body">${bodyHtml}</div>
      </section>`;
  }

  function gauge(pct) {
    const v = num(pct);
    const w = v == null ? 0 : Math.max(0, Math.min(100, v));
    const danger = w >= 90 ? " home-bar--danger" : w >= 70 ? " home-bar--warn" : "";
    return `
      <div class="home-bar${danger}">
        <div class="home-bar-fill" style="width:${w}%"></div>
      </div>`;
  }

  function metricRow(label, value) {
    return `<div class="home-kv"><span class="home-kv-k">${esc(label)}</span><span class="home-kv-v">${value}</span></div>`;
  }

  function shortReason(reason) {
    const raw = String(reason || "").trim();
    if (!raw) return "Usage limit reached";
    const ticket = (raw.match(/(?:on|hit on)\s+([A-Za-z0-9._-]+)/i) || [])[1];
    if (/usage limit|session limit|rate limit|429/i.test(raw)) {
      return ticket ? `Usage limit reached on ${ticket}` : "Usage limit reached";
    }
    if (/autopilot off/i.test(raw)) return "Autopilot is off";
    if (/disarmed/i.test(raw)) return "Board is disarmed";
    if (/night-only/i.test(raw)) return "Waiting for night window";
    if (/live usage .*unavailable|fail-safe/i.test(raw)) return "Live usage unavailable";
    if (/5h usage/i.test(raw)) return raw.replace(/\s+/g, " ").slice(0, 72);
    if (/weekly usage/i.test(raw)) return raw.replace(/\s+/g, " ").slice(0, 72);
    const clean = raw.replace(/\s+/g, " ");
    return clean.length > 78 ? clean.slice(0, 75) + "..." : clean;
  }

  function usageErrorLabel(reason) {
    const raw = String(reason || "").trim();
    if (/429/.test(raw)) return "endpoint rate-limited";
    if (/token/i.test(raw)) return "OAuth token unavailable";
    if (/fetch|timeout|abort/i.test(raw)) return "network timeout";
    return raw ? shortReason(raw).toLowerCase() : "endpoint unavailable";
  }

  function selectedEngine() {
    const allowed = home.config && Array.isArray(home.config.engines) ? home.config.engines : ["claude", "codex"];
    const stateEngine = home.state && home.state.defaultEngine;
    const configEngine = home.config && home.config.defaultEngine;
    if (allowed.includes(stateEngine)) return stateEngine;
    if (allowed.includes(configEngine)) return configEngine;
    return "claude";
  }

  function hasRunHistory() {
    const runs = Array.isArray(home.runs) ? home.runs : [];
    const schedulerRunning = home.scheduler && Array.isArray(home.scheduler.running) ? home.scheduler.running : [];
    return runs.length > 0 || schedulerRunning.length > 0;
  }

  function ticketMap() {
    return new Map((Array.isArray(home.tickets) ? home.tickets : []).map((t) => [t.id, t]));
  }

  function depsUnmet(ticket, byId) {
    const deps = Array.isArray(ticket && ticket.depends_on) ? ticket.depends_on : [];
    return deps.filter((id) => {
      const dep = byId.get(id);
      return !dep || dep.status !== "done";
    });
  }

  function isLaunchReady(ticket, byId, repos, running) {
    if (!ticket || !["triage", "backlog"].includes(ticket.status)) return false;
    if (running.has(ticket.id)) return false;
    if (depsUnmet(ticket, byId).length > 0) return false;
    if (!repos.has(ticket.repo)) return false;
    if (ticket.status !== "triage" && (!Array.isArray(ticket.acceptance_criteria) || !ticket.acceptance_criteria.length)) {
      return false;
    }
    return true;
  }

  function readiness() {
    const setup = home.setup || {};
    const config = home.config || {};
    const state = home.state || {};
    const tickets = Array.isArray(home.tickets) ? home.tickets : [];
    const byId = ticketMap();
    const repos = new Set(Array.isArray(config.repos) && config.repos.length ? config.repos : setup.repos || []);
    const runningIds = new Set([
      ...(Array.isArray(state.running) ? state.running : []),
      ...(home.scheduler && Array.isArray(home.scheduler.running) ? home.scheduler.running : []),
    ]);
    const repoRows = Array.isArray(setup.repoStatus) && setup.repoStatus.length
      ? setup.repoStatus
      : Array.from(repos).map((key) => ({ key, exists: null, path: "" }));
    const projectConfigured = !!setup.configPath && (repos.size > 0 || !!config.activeProject || !!setup.activeProject);
    const foldersReady = !!setup.ticketsDirExists && !!setup.indexExists;
    const supportFoldersReady = setup.agentDirExists !== false && setup.memoryQueueDirExists !== false;
    const reposReady = repos.size > 0 && repoRows.every((repo) => repo.exists !== false);
    const launchReady = tickets.filter((ticket) => isLaunchReady(ticket, byId, repos, runningIds));
    const restart = !!setup.requiresRestart
      || !!(setup.configuredActiveProject && setup.runtimeActiveProject && setup.configuredActiveProject !== setup.runtimeActiveProject);

    let stage = "no-project";
    if (hasRunHistory()) stage = "runs";
    else if (!projectConfigured) stage = "no-project";
    else if (!foldersReady || !supportFoldersReady || !reposReady || restart) stage = "folders-missing";
    else if (!tickets.length) stage = "no-tickets";
    else if (!launchReady.length) stage = "none-launch-ready";
    else stage = "launch-ready";

    return {
      stage,
      setup,
      config,
      state,
      tickets,
      launchReady,
      repoRows,
      projectConfigured,
      foldersReady,
      supportFoldersReady,
      reposReady,
      restart,
      engine: selectedEngine(),
    };
  }

  function renderBlockCard(opts = {}) {
    const u = home.usage;
    const b = u && u.block ? u.block : null;
    if (!u && !b) {
      const quiet = opts.quietUnavailable || selectedEngine() !== "claude";
      return card("5h Block Usage", `<p class="home-empty">${quiet ? "Claude usage is secondary for the current engine." : 'No usage data. <span class="home-na">/api/usage</span> not available.'}</p>`, { sub: quiet ? "secondary" : "" });
    }
    const pct = b ? b.pct : null;
    const official = (u && u.source === "official") || (b && b.source === "official");

    // Without the live endpoint we have NO trustworthy %: the local estimate is
    // cumulative cache-inflated tokens over an arbitrary budget. Show an honest
    // "unavailable" state instead of a misleading gauge.
    if (!official) {
      const reason = (b && b.officialError) || (u && u.officialError) || "endpoint unavailable";
      if (opts.quietUnavailable || selectedEngine() !== "claude") {
        return card("5h Block Usage", `
          <p class="home-empty home-empty--inline">Claude usage is secondary for the current engine.</p>
          <div class="home-note home-dim">Live Claude usage is retrying quietly.</div>
        `, { sub: "secondary" });
      }
      return card("5h Block Usage", `
        <div class="home-big">
          <span class="home-big-num home-big--muted">—</span>
          <span class="home-big-label">live 5h usage unavailable</span>
        </div>
        <div class="home-note">Claude usage endpoint: ${esc(usageErrorLabel(reason))}. Retrying quietly.</div>
        <div class="home-note home-dim">Local transcript totals are hidden here because they are not comparable to the real limit.</div>
      `, { sub: u && u.asOf ? relTime(u.asOf) : "" });
    }

    return card("5h Block Usage", `
      <div class="home-big">
        <span class="home-big-num">${fmtPct(pct)}</span>
        <span class="home-big-label">of 5h limit</span>
      </div>
      ${gauge(pct)}
      <div class="home-usage-line"><span class="home-src home-src--live">● LIVE</span> <span class="home-dim">Anthropic usage API · real 5h limit</span></div>
      <div class="home-note">live · Anthropic usage endpoint (same source as <span class="home-na">/usage</span>)</div>
      <div class="home-countdown" id="home-countdown">
        <span class="home-countdown-label">RESETS IN</span>
        <span class="home-countdown-val" id="home-countdown-val">—</span>
      </div>
    `, { sub: u && u.asOf ? relTime(u.asOf) : "" });
  }

  function renderBurnCard(opts = {}) {
    const u = home.usage;
    const codex = u && u.codex ? u.codex : null;
    if (codex) {
      const primary = codex.primary || {};
      const secondary = codex.secondary || {};
      const plan = codex.planType ? String(codex.planType) : "Codex";
      const reset = primary.resetTime ? untilTime(primary.resetTime) : "—";
      return card("Codex Usage", `
        <div class="home-big home-big--sm">
          <span class="home-big-num">${fmtPct(primary.pct)}</span>
          <span class="home-big-label">5h window</span>
        </div>
        ${gauge(primary.pct)}
        <div class="home-dispatch-grid">
          ${metricRow("7d window", fmtPct(secondary.pct))}
          ${metricRow("resets", esc(reset))}
          ${metricRow("plan", esc(plan))}
          ${metricRow("source", `<span class="home-src home-src--live">local</span>`)}
        </div>
        <div class="home-note">Latest Codex rate-limit snapshot from local session logs.</div>
      `, { sub: codex.asOf ? relTime(codex.asOf) : "" });
    }

    const b = u && u.block ? u.block : null;
    if (!b) {
      const quiet = opts.quietUnavailable || selectedEngine() === "codex";
      return card(selectedEngine() === "codex" ? "Codex Usage" : "Burn Rate", `<p class="home-empty">${quiet ? "Usage appears after local session data is available." : 'No burn data. <span class="home-na">/api/usage</span> not available.'}</p>`, { sub: quiet ? "quiet" : "" });
    }
    if (opts.quietUnavailable && selectedEngine() === "codex") {
      return card("Codex Usage", `
        <p class="home-empty home-empty--inline">Codex usage appears after local session data is available.</p>
        <div class="home-note home-dim">Claude burn data is secondary for the current engine.</div>
      `, { sub: "quiet" });
    }
    const burn = num(b.burnTokensPerMin);
    const official = (u && u.source === "official") || b.source === "official";

    // On the official path the budget/token figures are local cache-inflated
    // counts, so the "exhausts in N min" math (remaining budget / burn) is
    // meaningless — the real headroom is the live % + reset countdown on the 5h
    // card. Present the burn as a clearly-labelled LOCAL rate only.
    if (official) {
      const pct = num(b.pct);
      const capPct = home.scheduler && num(home.scheduler.activeCapPct) != null
        ? num(home.scheduler.activeCapPct) * 100
        : 100;
      const headroom = pct != null ? Math.max(0, Math.round(capPct - pct)) : null;
      return card("Burn Rate", `
        <div class="home-big home-big--sm">
          <span class="home-big-num">${burn == null ? "—" : fmtTokens(burn)}</span>
          <span class="home-big-label">tokens / min <span class="home-dim">(local · incl. cache reads)</span></span>
        </div>
        <div class="home-exhaust">${headroom != null ? `<strong>~${headroom}%</strong> headroom to dispatch cap` : `<span class="home-dim">see 5h gauge for headroom</span>`}</div>
        <div class="home-note">local trend signal · real limit is the live 5h %</div>
      `);
    }

    // Estimate fallback (live endpoint down). The budget-based "exhausts in"
    // math divides by an arbitrary budget the cache-inflated token count often
    // already exceeds — so it produces garbage. Show the local rate only,
    // clearly labelled, with no projection.
    return card("Burn Rate", `
      <div class="home-big home-big--sm">
        <span class="home-big-num">${burn == null ? "—" : fmtTokens(burn)}</span>
        <span class="home-big-label">tokens / min <span class="home-dim">(local · incl. cache reads)</span></span>
      </div>
      <div class="home-note">local trend signal only · live usage % unavailable</div>
    `);
  }

  function renderWeeklyCard(opts = {}) {
    const u = home.usage;
    const w = u && u.weekly ? u.weekly : null;
    if (!w) {
      const quiet = opts.quietUnavailable || selectedEngine() !== "claude";
      return card("Weekly Usage", `<p class="home-empty">${quiet ? "Claude weekly usage is secondary for the current engine." : "No weekly data."}</p>`, { sub: quiet ? "secondary" : "" });
    }
    const official = w.source === "official";

    // Extra-usage (pay-as-you-go). RAW `used_credits` counter, unit unverified —
    // NOT a confirmed dollar charge (no `spend` field; vusage reports actual
    // spend as $0.00). Neutral raw count, no currency symbol, no alarm.
    const eu = u ? u.extra_usage : null;
    let extraLine = "";
    if (eu && eu.enabled && eu.used_credits != null) {
      const lim = eu.monthly_limit != null ? ` / ${eu.monthly_limit}` : "";
      extraLine = `<div class="home-note">extra-usage credits: ${esc(String(eu.used_credits))}${esc(lim)} <span class="home-dim">(raw count · unit unverified)</span></div>`;
    }

    // Without the live endpoint, the local weekly % is meaningless (cumulative
    // cache-inflated tokens ÷ arbitrary budget — produces a fake "250%"). Show
    // an honest unavailable state rather than that number.
    if (!official) {
      const reason = w.officialError || (u && u.officialError) || "endpoint unavailable";
      if (opts.quietUnavailable || selectedEngine() !== "claude") {
        return card("Weekly Usage", `
          <p class="home-empty home-empty--inline">Claude weekly usage is secondary for the current engine.</p>
          <div class="home-note home-dim">Live Claude usage is retrying quietly.</div>
          ${extraLine}
        `, { sub: "secondary" });
      }
      return card("Weekly Usage", `
        <div class="home-big home-big--sm">
          <span class="home-big-num home-big--muted">—</span>
          <span class="home-big-label">live 7d usage unavailable</span>
        </div>
        <div class="home-note">Claude usage endpoint: ${esc(usageErrorLabel(reason))}. Retrying quietly.</div>
        <div class="home-note home-dim">Local transcript totals are hidden here because they are not comparable to the real limit.</div>
        ${extraLine}
      `);
    }

    return card("Weekly Usage", `
      <div class="home-big home-big--sm">
        <span class="home-big-num">${fmtPct(w.pct)}</span>
        <span class="home-big-label">of 7d limit</span>
      </div>
      ${gauge(w.pct)}
      <div class="home-usage-line"><span class="home-src home-src--live">● LIVE</span> <span class="home-dim">7-day window · Anthropic usage API</span></div>
      ${extraLine}
    `);
  }

  function renderDispatchCard() {
    const s = home.scheduler;
    if (!s) {
      return card("Dispatch", `<p class="home-empty">Scheduler offline. <span class="home-na">/api/scheduler</span> not available.</p>`);
    }
    const autopilot = !!s.autopilot;
    const armed = !!s.armed;
    // autopilot ON but armed false => paused; surface reason from lastDecisions if any.
    let pausedReason = null;
    if (autopilot && !armed) pausedReason = "disarmed";
    if (Array.isArray(s.lastDecisions)) {
      const lastPause = [...s.lastDecisions].reverse().find((d) => d && d.action === "paused");
      if (lastPause && lastPause.reason) pausedReason = lastPause.reason;
    }
    const pausedLabel = pausedReason ? shortReason(pausedReason) : null;

    const stateLabel = !autopilot ? "OFF" : pausedReason ? "PAUSED" : "ON";
    const stateClass = !autopilot ? "home-pill--off" : pausedReason ? "home-pill--warn" : "home-pill--on";

    const toggleClass = autopilot ? "home-toggle home-toggle--on" : "home-toggle home-toggle--off";
    const toggleLabel = autopilot ? "Autopilot ON" : "Autopilot OFF";

    const mode = s.mode === "night" ? "Night" : s.mode === "day" ? "Day" : "—";
    const cap = num(s.activeCapPct) != null ? fmtFractionPct(s.activeCapPct) : "—";
    const nextPoll = (() => {
      if (num(s.nextPollInSec) != null) return fmtMin(num(s.nextPollInSec) / 60);
      if (num(s.pollIntervalMin) != null) return "~" + fmtMin(num(s.pollIntervalMin));
      return "—";
    })();

    const decisions = Array.isArray(s.lastDecisions) ? s.lastDecisions.slice(-4).reverse() : [];
    const decisionsHtml = decisions.length
      ? `<ul class="home-list">${decisions
          .map((d) => {
            const a = d && d.action ? d.action : "?";
            const aClass =
              a === "dispatched" ? "home-tag--on" : a === "paused" ? "home-tag--warn" : "home-tag--dim";
            return `<li>
              <span class="home-tag ${aClass}">${esc(a)}</span>
              <span class="home-list-main">${esc(d && d.ticket ? d.ticket : "—")}</span>
              <span class="home-list-meta home-list-reason" title="${esc(d && d.reason ? d.reason : "")}">${esc(shortReason(d && d.reason ? d.reason : ""))}</span>
              <span class="home-list-meta home-dim">${esc(d && d.ts ? relTime(d.ts) : "")}</span>
            </li>`;
          })
          .join("")}</ul>`
      : `<p class="home-empty home-empty--inline">No recent decisions.</p>`;

    return card("Dispatch", `
      <div class="home-dispatch-top">
        <span class="home-pill ${stateClass}" title="${esc(pausedReason || "")}">${stateLabel}${pausedLabel ? ` · ${esc(pausedLabel)}` : ""}</span>
        <button type="button" class="${toggleClass}" id="home-autopilot">
          <span class="home-toggle-dot"></span>${toggleLabel}
        </button>
      </div>
      <div class="home-dispatch-grid">
        ${metricRow("mode", `${esc(mode)}${s.nightOnly ? " · night-only" : ""}`)}
        ${metricRow("active cap", cap)}
        ${metricRow("next poll", nextPoll)}
        ${metricRow("WIP limit", num(s.wipLimit) != null ? fmtInt(s.wipLimit) : "—")}
      </div>
      <div class="home-sub-head">Recent decisions</div>
      ${decisionsHtml}
    `);
  }

  function runTokens(r) {
    if (!r) return null;
    if (r.tokens && typeof r.tokens === "object") {
      const t = num(r.tokens.total);
      if (t != null) return t;
      const sum = ["input", "output"].reduce((acc, k) => acc + (num(r.tokens[k]) || 0), 0);
      return sum || null;
    }
    return num(r.tokens);
  }

  function renderRunningCard() {
    const s = home.scheduler;
    const runs = Array.isArray(home.runs) ? home.runs : [];
    const runningIds = s && Array.isArray(s.running) ? s.running : [];

    // Prefer live runs from the ledger; fall back to scheduler.running ids.
    const liveRuns = runs.filter((r) => r && r.status === "running");
    let rows;
    if (liveRuns.length) {
      rows = liveRuns.map((r) => {
        const tok = runTokens(r);
        return `<li>
          <span class="home-list-main mono">${esc(r.ticket_id || r.run_id || "—")}</span>
          <span class="home-list-meta">${fmtTokens(tok)} tok</span>
          <span class="home-list-meta home-dim">${fmtDuration(r.started_at, null)}</span>
        </li>`;
      });
    } else if (runningIds.length) {
      rows = runningIds.map(
        (id) => `<li><span class="home-list-main mono">${esc(id)}</span><span class="home-list-meta home-dim">running</span></li>`
      );
    } else {
      rows = null;
    }

    const body = rows
      ? `<ul class="home-list">${rows.join("")}</ul>`
      : `<p class="home-empty home-empty--inline">Nothing running.</p>`;

    return card("Running Now", body, { sub: rows ? String(rows.length) : "idle" });
  }

  function renderRecentRunsCard() {
    const runs = Array.isArray(home.runs) ? home.runs : null;
    if (runs == null) {
      return card("Recent Dispatches", `<p class="home-empty"><span class="home-na">/api/runs</span> not available.</p>`);
    }
    const finished = runs
      .filter((r) => r && r.status && r.status !== "running")
      .slice()
      .sort((a, b) => Date.parse(b.ended_at || b.started_at || 0) - Date.parse(a.ended_at || a.started_at || 0))
      .slice(0, 8);

    // Learned avg cost per ticket.
    const costs = runs.map((r) => num(r && r.costUSD)).filter((c) => c != null);
    const avgCost = costs.length ? costs.reduce((a, c) => a + c, 0) / costs.length : null;

    const body = finished.length
      ? `<ul class="home-list">${finished
          .map((r) => {
            const st = r.status || "?";
            const stClass =
              st === "exited" && (r.exit_code === 0 || r.exit_code == null)
                ? "home-tag--on"
                : st === "killed" || st === "lost" || (num(r.exit_code) || 0) > 0
                ? "home-tag--warn"
                : "home-tag--dim";
            return `<li>
              <span class="home-tag ${stClass}">${esc(st)}</span>
              <span class="home-list-main mono">${esc(r.ticket_id || r.run_id || "—")}</span>
              <span class="home-list-meta">${fmtTokens(runTokens(r))} tok</span>
              <span class="home-list-meta">${fmtUSD(r.costUSD)}</span>
              <span class="home-list-meta home-dim">${fmtDuration(r.started_at, r.ended_at)}</span>
            </li>`;
          })
          .join("")}</ul>`
      : `<p class="home-empty home-empty--inline">No completed runs yet.</p>`;

    return card("Recent Dispatches", `
      ${body}
      <div class="home-foot">
        <span class="home-foot-k">avg cost / ticket</span>
        <span class="home-foot-v">${fmtUSD(avgCost)}</span>
      </div>
    `, { sub: finished.length ? `${finished.length} shown` : "" });
  }

  function renderCiCard() {
    const s = home.scheduler;
    const ci = s && Array.isArray(s.ciWatch) ? s.ciWatch : null;
    if (!ci) {
      return card("CI Watch", `<p class="home-empty home-empty--inline">No CI watch data.</p>`);
    }
    if (!ci.length) {
      return card("CI Watch", `<p class="home-empty home-empty--inline">No PRs being watched.</p>`);
    }
    const body = `<ul class="home-list">${ci
      .map((c) => {
        const st = c && c.state ? c.state : "unknown";
        const stClass =
          st === "pass"
            ? "home-tag--on"
            : st === "fail" || st === "conflict"
            ? "home-tag--bad"
            : st === "pending"
            ? "home-tag--warn"
            : "home-tag--dim";
        // c.pr is a full PR URL; show "<repo> #<num>".
        const num = c && c.pr ? (String(c.pr).match(/\/pull\/(\d+)/) || [])[1] : null;
        const prTxt = num ? `${c.repo ? esc(c.repo) + " " : ""}#${esc(num)}` : "—";
        const sent = c && (c.fixDispatched || c.conflictFixDispatched);
        const fixBtn =
          c && c.fixable
            ? `<button type="button" class="home-ci-fix" data-ticket="${esc(c.ticket)}" data-pr="${esc(
                c.pr || ""
              )}" data-kind="${st === "conflict" ? "conflict-fix" : "ci-fix"}">${
                st === "conflict" ? "Resolve" : "Fix CI"
              }</button>`
            : "";
        return `<li>
          <span class="home-tag ${stClass}">${esc(st)}</span>
          <span class="home-list-main mono">${esc(c && c.ticket ? c.ticket : "—")}</span>
          <span class="home-list-meta">${prTxt}</span>
          ${sent ? `<span class="home-list-meta home-tag--warn">fix sent</span>` : ""}
          ${fixBtn}
        </li>`;
      })
      .join("")}</ul>`;
    return card("CI Watch", body, { sub: String(ci.length) });
  }

  function stepRow(ok, label, detail, tone = "") {
    return `
      <li class="${ok ? "projects-step projects-step--done" : "projects-step"}${tone ? ` projects-step--${tone}` : ""}">
        <span class="projects-step-dot"></span>
        <span class="projects-step-main">${esc(label)}</span>
        <span class="projects-step-detail">${esc(detail || "not configured")}</span>
      </li>`;
  }

  function stageCopy(stage) {
    const map = {
      "no-project": {
        title: "Connect a project",
        detail: "Choose or create a project configuration before HelmMate can prepare tickets.",
        sub: "first run",
      },
      "folders-missing": {
        title: "Prepare local folders",
        detail: "Create the ticket index and support folders, then confirm repos are reachable.",
        sub: "setup",
      },
      "no-tickets": {
        title: "Create a first ticket",
        detail: "The project is ready for tickets. Start with one reviewed, small task.",
        sub: "ready",
      },
      "none-launch-ready": {
        title: "Review tickets",
        detail: "Tickets exist, but none currently satisfy the launch checks.",
        sub: "needs review",
      },
      "launch-ready": {
        title: "Ready to launch",
        detail: "At least one ticket can launch once the board is armed and dispatch is enabled.",
        sub: "launch-ready",
      },
    };
    return map[stage] || map["no-project"];
  }

  function renderReadinessSummary(r) {
    const copy = stageCopy(r.stage);
    const readyCount = r.launchReady.length;
    const ticketCount = r.tickets.length;
    const board = r.state || {};
    const dispatchState = !readyCount
      ? "waiting"
      : board.armed && home.scheduler && home.scheduler.autopilot
      ? "enabled"
      : board.armed
      ? "arm on"
      : "disarmed";
    return card("Home Readiness", `
      <div class="home-ready-hero">
        <span class="home-ready-kicker">${esc(copy.sub)}</span>
        <h2>${esc(copy.title)}</h2>
        <p>${esc(copy.detail)}</p>
      </div>
      <div class="home-ready-stats">
        ${metricRow("project", esc(r.setup.activeProject || r.config.activeProject || "none"))}
        ${metricRow("tickets", fmtInt(ticketCount))}
        ${metricRow("launch-ready", fmtInt(readyCount))}
        ${metricRow("dispatch", esc(dispatchState))}
      </div>
    `);
  }

  function renderReadinessChecklist(r) {
    const repoDetail = r.repoRows.length
      ? r.repoRows
          .map((repo) => {
            const state = repo.exists === true ? "ok" : repo.exists === false ? "missing" : "configured";
            return `${repo.key}: ${state}${repo.path ? ` (${repo.path})` : ""}`;
          })
          .join("; ")
      : "none";
    const setup = r.setup || {};
    const board = r.state || {};
    const readyTicketDetail = r.launchReady.length
      ? r.launchReady.slice(0, 3).map((t) => t.id).join(", ")
      : r.tickets.length
      ? "move a reviewed ticket to triage/backlog with deps done"
      : "create a starter ticket";
    return card("Readiness Checklist", `
      <ul class="projects-steps">
        ${stepRow(r.projectConfigured, "Project config", setup.configPath || "open Projects to configure")}
        ${stepRow(!r.restart, "Active project", r.restart ? setup.restartReason || "restart needed to load selected project" : setup.runtimeActiveProject || setup.activeProject || "loaded", r.restart ? "warn" : "")}
        ${stepRow(!!setup.ticketsDirExists, "Tickets directory", setup.ticketsDir || "not configured")}
        ${stepRow(!!setup.indexExists, "Ticket index", setup.indexExists ? "_index.json exists" : "missing or will be created")}
        ${stepRow(setup.agentDirExists !== false, "Agent folder", setup.agentDir || "not configured")}
        ${stepRow(setup.memoryQueueDirExists !== false, "Memory queue", setup.memoryQueueDir || "not configured")}
        ${stepRow(r.reposReady, "Configured repos", repoDetail)}
        ${stepRow(r.tickets.length > 0, "Tickets", r.tickets.length ? `${r.tickets.length} found` : "none yet")}
        ${stepRow(r.launchReady.length > 0, "Launch-ready tickets", readyTicketDetail)}
        ${stepRow(board.armed === false, "Board starts safe", board.armed === true ? "armed" : board.armed === false ? "disarmed" : "unknown", board.armed === true ? "warn" : "")}
      </ul>
    `, { sub: r.stage === "launch-ready" ? `${r.launchReady.length} ready` : "next check" });
  }

  function actionButton(id, label, primary = false) {
    return `<button class="projects-btn${primary ? " projects-btn--primary" : ""}" id="${esc(id)}" type="button">${esc(label)}</button>`;
  }

  function renderNextActions(r) {
    let lead = "Open Projects to connect a workspace.";
    let buttons = [actionButton("home-open-projects", "Open Projects", true)];

    if (r.stage === "folders-missing") {
      lead = r.restart ? "Restart the server after the selected project change, then refresh Home." : "Initialize the local ticket and agent folders.";
      buttons = [
        actionButton("home-init-folders", "Initialize folders", true),
        actionButton("home-open-projects", "Open Projects"),
        actionButton("home-refresh", "Refresh"),
      ];
    } else if (r.stage === "no-tickets") {
      lead = "Create a small starter ticket, then review it on the Board.";
      buttons = [
        actionButton("home-create-ticket", "Create starter ticket", true),
        actionButton("home-open-board", "Open Board"),
        actionButton("home-open-projects", "Open Projects"),
      ];
    } else if (r.stage === "none-launch-ready") {
      lead = "Review ticket status, dependencies, repo, and acceptance criteria.";
      buttons = [
        actionButton("home-open-board", "Review Board", true),
        actionButton("home-create-ticket", "Create starter ticket"),
        actionButton("home-open-projects", "Run Doctor"),
      ];
    } else if (r.stage === "launch-ready") {
      const armed = !!(r.state && r.state.armed);
      const autopilot = !!(home.scheduler && home.scheduler.autopilot);
      lead = !armed
        ? "Arm the board when you want launch-ready tickets to run."
        : !autopilot
        ? "Enable autopilot to let the scheduler dispatch ready work."
        : "The scheduler can dispatch on its next poll.";
      buttons = [
        !armed ? actionButton("home-arm-board", "Arm board", true) : !autopilot ? actionButton("home-autopilot-ready", "Enable autopilot", true) : actionButton("home-open-board", "Open Board", true),
        actionButton("home-open-board", "Review Board"),
        actionButton("home-refresh", "Refresh"),
      ];
    }

    return card("Next Actions", `
      <p class="home-ready-lead">${esc(lead)}</p>
      <div class="projects-actions">${buttons.join("")}</div>
      <div class="home-note home-dim">Home stays in readiness mode until a run is active or recorded.</div>
    `);
  }

  function renderReadinessUsage(r) {
    const engineLabel = r.engine === "codex" ? "Codex" : "Claude";
    const usageCard = r.engine === "codex"
      ? renderBurnCard({ quietUnavailable: true })
      : renderBlockCard();
    return `
      ${card("Default Engine", `
        <div class="home-big home-big--sm">
          <span class="home-big-num">${esc(engineLabel)}</span>
          <span class="home-big-label">selected for launches</span>
        </div>
        <div class="home-note">${r.engine === "codex" ? "Claude usage is secondary while Codex is the default engine." : "Claude usage matters for Claude launches and scheduler caps."}</div>
      `, { sub: "routing" })}
      ${usageCard}`;
  }

  function renderReadinessHome() {
    const r = readiness();
    return `
      ${renderBreakerBanner()}
      <div class="home-ready-grid">
        ${renderReadinessSummary(r)}
        ${renderNextActions(r)}
        ${renderReadinessChecklist(r)}
        ${renderDispatchCard()}
        ${renderReadinessUsage(r)}
      </div>`;
  }

  function renderBreakerBanner() {
    const s = home.scheduler;
    const b = s && s.breaker ? s.breaker : null;
    if (!b || !b.tripped) return "";
    const until = b.until ? new Date(b.until).toLocaleTimeString() : "manual reset";
    const reason = b.reason || "usage limit hit";
    return `
      <div class="home-breaker" role="alert">
        <div class="home-breaker-main">
          <span class="home-breaker-flag">Usage paused</span>
          <span class="home-breaker-reason" title="${esc(reason)}">${esc(shortReason(reason))}. Auto-dispatch is off until <strong>${esc(until)}</strong>.</span>
        </div>
        <button type="button" class="home-breaker-reset" id="home-breaker-reset">Reset breaker</button>
      </div>`;
  }

  function render() {
    const root = $("#home");
    if (!root) return;
    const engine = selectedEngine();
    if (!hasRunHistory()) {
      root.innerHTML = renderReadinessHome();
    } else {
      const quietClaude = engine !== "claude";
      root.innerHTML = `
        ${renderBreakerBanner()}
        <div class="home-grid${quietClaude ? " home-grid--codex" : ""}">
          ${quietClaude ? renderBurnCard({ quietUnavailable: true }) : renderBlockCard()}
          ${quietClaude ? renderBlockCard({ quietUnavailable: true }) : renderBurnCard()}
          ${renderWeeklyCard({ quietUnavailable: quietClaude })}
          ${renderDispatchCard()}
          ${renderRunningCard()}
          ${renderRecentRunsCard()}
          ${renderCiCard()}
        </div>`;
    }

    const ap = $("#home-autopilot");
    if (ap) ap.addEventListener("click", toggleAutopilot);
    const readyAp = $("#home-autopilot-ready");
    if (readyAp) readyAp.addEventListener("click", toggleAutopilot);

    const rb = $("#home-breaker-reset");
    if (rb) rb.addEventListener("click", resetBreaker);
    $("#home-init-folders")?.addEventListener("click", (e) => initializeFolders(e.currentTarget));
    $("#home-create-ticket")?.addEventListener("click", (e) => createStarterTicket(e.currentTarget));
    $("#home-arm-board")?.addEventListener("click", (e) => setArmed(true, e.currentTarget));
    $("#home-refresh")?.addEventListener("click", poll);
    $("#home-open-projects")?.addEventListener("click", () => window.helmmateSetView && window.helmmateSetView("projects"));
    $("#home-open-board")?.addEventListener("click", () => window.helmmateSetView && window.helmmateSetView("board"));

    root.querySelectorAll(".home-ci-fix").forEach((b) => {
      b.addEventListener("click", () =>
        dispatchTicketFix(
          b.getAttribute("data-ticket"),
          b.getAttribute("data-kind"),
          b.getAttribute("data-pr"),
          b
        )
      );
    });

    tickCountdown(); // paint immediately
  }

  // ---------- live reset countdown (ticks every 1s, independent of poll) ----------
  function tickCountdown() {
    const el = $("#home-countdown-val");
    if (!el) return;
    if (home.resetAt == null) {
      el.textContent = "—";
      return;
    }
    const remaining = home.resetAt - Date.now();
    el.textContent = remaining <= 0 ? "0:00" : fmtClock(remaining);
    el.classList.toggle("home-countdown-val--soon", remaining > 0 && remaining < 15 * 60000);
  }

  // ---------- lifecycle ----------
  function startHome() {
    if (home.visible) return;
    home.visible = true;
    poll();
    home.timer = setInterval(poll, POLL_MS);
    home.countdownTimer = setInterval(tickCountdown, 1000);
  }

  function stopHome() {
    home.visible = false;
    if (home.timer) clearInterval(home.timer);
    if (home.countdownTimer) clearInterval(home.countdownTimer);
    home.timer = null;
    home.countdownTimer = null;
  }

  // ---------- tab shell (sidebar nav: Home | Board | Agents | Projects) ----------
  const VIEWS = ["home", "board", "agents", "projects"];

  function setView(view, { persist = true } = {}) {
    if (!VIEWS.includes(view)) view = "board";

    for (const v of VIEWS) {
      const sec = $("#view-" + v);
      if (sec) sec.hidden = v !== view;
    }
    document.querySelectorAll(".side-tab").forEach((btn) => {
      const active = btn.getAttribute("data-view") === view;
      btn.classList.toggle("side-tab--active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });

    if (persist) {
      try {
        localStorage.setItem(TAB_KEY, view);
      } catch {
        /* private mode, ignore */
      }
    }

    // Per-view lifecycle. Home + Agents own their own poll/fetch loops; start the
    // active one and stop the others so background polling pauses off-screen.
    if (view === "home") startHome();
    else stopHome();

    if (window.agentsView) {
      if (view === "agents") window.agentsView.start && window.agentsView.start();
      else window.agentsView.stop && window.agentsView.stop();
    }

    if (window.projectsView) {
      if (view === "projects") window.projectsView.start && window.projectsView.start();
      else window.projectsView.stop && window.projectsView.stop();
    }
  }

  function initTabs() {
    document.querySelectorAll(".side-tab").forEach((btn) => {
      btn.addEventListener("click", () => setView(btn.getAttribute("data-view")));
    });

    // Default to Board to avoid surprising the user; remember last tab.
    let initial = "board";
    try {
      const saved = localStorage.getItem(TAB_KEY);
      if (VIEWS.includes(saved)) initial = saved;
    } catch {
      /* ignore */
    }
    setView(initial, { persist: false });
  }

  window.helmmateSetView = setView;

  // Pause polling when the whole tab/window is hidden (battery friendly).
  document.addEventListener("visibilitychange", () => {
    if (!home.visible) return;
    if (document.hidden) {
      if (home.timer) clearInterval(home.timer);
      home.timer = null;
    } else if (!home.timer) {
      poll();
      home.timer = setInterval(poll, POLL_MS);
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initTabs);
  } else {
    initTabs();
  }
})();
