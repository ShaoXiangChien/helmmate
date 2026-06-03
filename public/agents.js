// HelmMate Agents view — vanilla JS, no framework, no imports.
// Exposes: window.agentsView = { start, stop }
// Renders into <main id="agents">. Fetch-once on start; explicit Refresh button.

(function () {
  "use strict";

  // -----------------------------------------------------------------------
  // Module state
  // -----------------------------------------------------------------------
  const agents = {
    visible: false,
    data: null, // last successful /api/agents response
    queue: null, // last successful /api/memory-queue response
    timer: null, // idle auto-refresh interval
  };

  // -----------------------------------------------------------------------
  // DOM helpers
  // -----------------------------------------------------------------------
  const $ = (sel) => document.querySelector(sel);

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // -----------------------------------------------------------------------
  // Formatting helpers (tolerate null / NaN everywhere)
  // -----------------------------------------------------------------------
  function num(n) {
    if (n == null || Number.isNaN(Number(n))) return null;
    return Number(n);
  }

  function fmtTokens(n) {
    const v = num(n);
    if (v == null) return "—";
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1) + "M";
    if (v >= 1_000) return (v / 1_000).toFixed(v >= 10_000 ? 0 : 1) + "k";
    return String(Math.round(v));
  }

  function fmtUSD(n, hasCost) {
    if (hasCost === false) return "—";
    const v = num(n);
    if (v == null) return "—";
    return "$" + v.toFixed(v >= 100 ? 0 : 2);
  }

  function fmtInt(n) {
    const v = num(n);
    if (v == null) return "—";
    return Math.round(v).toLocaleString("en-US");
  }

  // -----------------------------------------------------------------------
  // Data fetching
  // -----------------------------------------------------------------------
  async function getJSON(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async function fetchAgents() {
    setRefreshState(true);
    const [data, queue] = await Promise.all([
      getJSON("/api/agents"),
      getJSON("/api/memory-queue"),
    ]);
    agents.data = data;
    agents.queue = queue;
    setRefreshState(false);
    render();
  }

  // Auto-refresh the spend/queue on a gentle cadence, but never while the user
  // is reading an expanded proposal.
  function busy() {
    const root = $("#agents");
    if (!root) return true;
    if (root.querySelector("details[open]")) return true;
    return false;
  }

  function maybeRefresh() {
    if (!agents.visible || busy()) return;
    fetchAgents();
  }

  function setRefreshState(loading) {
    const btn = $("#agents-refresh");
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading ? "Loading…" : "Refresh";
  }

  // -----------------------------------------------------------------------
  // Rendering helpers
  // -----------------------------------------------------------------------

  // Model badge — sonnet = teal (armed), opus = amber (p1), others = dim
  function modelBadge(model) {
    const m = String(model || "").toLowerCase();
    let cls = "agents-badge agents-badge--dim";
    if (m.includes("sonnet")) cls = "agents-badge agents-badge--sonnet";
    else if (m.includes("opus")) cls = "agents-badge agents-badge--opus";
    else if (m.includes("haiku")) cls = "agents-badge agents-badge--haiku";
    return `<span class="${cls}">${esc(model || "unknown")}</span>`;
  }

  function statusBadge(ok, label) {
    return `<span class="agents-file-badge ${ok ? "agents-file-badge--ok" : "agents-file-badge--missing"}">${esc(label || (ok ? "exists" : "missing"))}</span>`;
  }

  function pathLine(label, value, ok) {
    return `
      <div class="agents-path-row">
        <span>${esc(label)}</span>
        <code>${esc(value || "not configured")}</code>
        ${typeof ok === "boolean" ? statusBadge(ok) : ""}
      </div>`;
  }

  function setupOverview(setup) {
    if (!setup) return "";
    const engine = setup.engine || {};
    const permissions = setup.permissions || {};
    const locations = setup.locations || {};
    const prompts = Array.isArray(setup.prompts) ? setup.prompts : [];
    const routing = setup.roleRouting || {};
    const mappings = Array.isArray(routing.repoMappings) ? routing.repoMappings : [];

    const engineCards = `
      <section class="home-card agents-trust-card">
        <div class="home-card-head">
          <h3>Default engine</h3>
          ${modelBadge(engine.default || "unknown")}
        </div>
        <div class="home-card-body">
          <p class="agents-copy">${esc(engine.explanation || "")}</p>
          <div class="agents-kv-grid">
            <div><span>board default</span><strong>${esc(engine.default || "unknown")}</strong></div>
            <div><span>config default</span><strong>${esc(engine.configuredDefault || "unknown")}</strong></div>
            <div><span>allowed</span><strong>${esc((engine.allowed || []).join(", ") || "none")}</strong></div>
          </div>
          ${pathLine("Claude command", engine.commands && engine.commands.claude)}
          ${pathLine("Codex command", engine.commands && engine.commands.codex)}
        </div>
      </section>`;

    const promptRows = prompts.length
      ? prompts.map((p) => pathLine(p.label || p.key, `${p.ref || ""}${p.path ? " -> " + p.path : ""}`, !!p.exists)).join("")
      : `<p class="home-empty">No prompt files configured.</p>`;

    const repoRows = mappings.length
      ? mappings
          .map(
            (repo) => `
              <tr>
                <td>${esc(repo.key)}</td>
                <td>${esc(repo.role || "cross-repo")}</td>
                <td>${esc(repo.worktree ? "worktree" : "in-place")}</td>
                <td>${statusBadge(!!repo.exists, repo.exists ? "repo found" : "missing")}</td>
              </tr>`
          )
          .join("")
      : `<tr><td colspan="4">No repos configured.</td></tr>`;

    const routingCard = `
      <section class="home-card agents-trust-card agents-trust-card--wide">
        <div class="home-card-head">
          <h3>Role routing</h3>
        </div>
        <div class="home-card-body">
          <p class="agents-copy">${esc(routing.explanation || "")}</p>
          <table class="agents-routing-table">
            <thead><tr><th>repo</th><th>role</th><th>mode</th><th>status</th></tr></thead>
            <tbody>${repoRows}</tbody>
          </table>
        </div>
      </section>`;

    const promptCard = `
      <section class="home-card agents-trust-card">
        <div class="home-card-head">
          <h3>Prompt files</h3>
        </div>
        <div class="home-card-body agents-path-stack">${promptRows}</div>
      </section>`;

    const warningCard = `
      <section class="home-card agents-trust-card agents-warning-card">
        <div class="home-card-head">
          <h3>Permission warning</h3>
          ${statusBadge(false, "review")}
        </div>
        <div class="home-card-body">
          <p class="agents-copy">${esc(permissions.text || "")}</p>
          <div class="agents-path-stack">
            ${pathLine("Claude flag", permissions.claude)}
            ${pathLine("Codex flag", permissions.codex)}
            ${pathLine("Run logs", locations.ticketLogPattern || locations.logsDir)}
            ${pathLine("Runs ledger", locations.runsLedger)}
            ${pathLine("Memory proposals", locations.memoryProposalPattern || locations.memoryQueueDir)}
          </div>
        </div>
      </section>`;

    return `
      <section class="agents-setup-section">
        <div class="agents-section-head">
          <h3>Before launch</h3>
          <span>read-only setup review</span>
        </div>
        <div class="agents-trust-grid">
          ${engineCards}
          ${routingCard}
          ${promptCard}
          ${warningCard}
        </div>
      </section>`;
  }

  // Spend summary table for byRole or byModel
  function spendTable(buckets, kind) {
    if (!buckets || !Object.keys(buckets).length) {
      return `<p class="home-empty">No ${esc(kind)} spend data.</p>`;
    }

    const rows = Object.entries(buckets)
      .sort((a, b) => (num(b[1].runs) || 0) - (num(a[1].runs) || 0))
      .map(([key, v]) => {
        const isOpus = kind === "model" && String(key).toLowerCase().includes("opus");
        const nameClass = isOpus ? "agents-spend-name agents-spend-name--opus" : "agents-spend-name";
        return `
          <tr>
            <td class="${nameClass}">${esc(key)}</td>
            <td class="agents-spend-num">${fmtInt(v.runs)}</td>
            <td class="agents-spend-num">${fmtTokens(v.tokens_metric)}</td>
            <td class="agents-spend-num">${fmtUSD(v.cost_usd, v.has_cost)}</td>
          </tr>`;
      })
      .join("");

    return `
      <table class="agents-spend-table">
        <thead>
          <tr>
            <th>${esc(kind)}</th>
            <th>runs</th>
            <th>tokens</th>
            <th>cost</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  // One read-only agent card
  function agentCard(agent, usageByRole, codexConfig) {
    const role = agent.role || "unknown";
    const roleUsage = usageByRole && usageByRole[role] ? usageByRole[role] : null;
    const codexModel = codexConfig && codexConfig.modelByRole ? codexConfig.modelByRole[role] : null;
    const codexEffort = codexConfig && codexConfig.effortByRole ? codexConfig.effortByRole[role] : null;
    const setupRole = agent.persona ? agent : null;
    const persona = setupRole ? setupRole.persona : agent;
    const exists = agent.exists !== false && (!persona || persona.exists !== false);
    const claude = agent.claude || {};
    const preview = persona && persona.preview != null ? persona.preview : agent.body || "";

    const runsLine = roleUsage
      ? `${fmtInt(roleUsage.runs)} run${num(roleUsage.runs) !== 1 ? "s" : ""} · ${fmtUSD(roleUsage.cost_usd, roleUsage.has_cost)}`
      : "no runs yet";

    return `
      <section class="home-card agents-editor-card">
        <div class="home-card-head">
          <h3>${esc(role)}</h3>
          ${statusBadge(exists, exists ? "persona found" : "persona missing")}
        </div>
        <div class="home-card-body">
          <p class="agents-copy">${esc(agent.meaning || "Repo-specific implementation role.")}</p>
          <div class="agents-runs-line">${esc(runsLine)}</div>
          <div class="agents-model-grid">
            <div>
              <span>Claude model</span>
              <strong>${esc(claude.model || agent.model || agent.configuredModel || "sonnet")}</strong>
              <small>${esc(claude.source || (agent.model ? "persona frontmatter" : "role config"))}</small>
            </div>
            <div>
              <span>Codex model</span>
              <strong>${esc(codexModel || (agent.codex && agent.codex.model) || "gpt-5.4-mini")}</strong>
              <small>effort ${esc(codexEffort || (agent.codex && agent.codex.effort) || "medium")}</small>
            </div>
          </div>

          ${pathLine("persona", (persona && persona.path) || agent.path, exists)}

          <details class="agents-persona-details"${exists && preview ? " open" : ""}>
            <summary>persona preview</summary>
            ${
              exists && preview
                ? `<pre class="agents-persona-pre">${esc(preview)}${persona && persona.previewTruncated ? "\n..." : ""}</pre>`
                : `<p class="home-empty">Missing or empty persona file.</p>`
            }
          </details>
        </div>
      </section>`;
  }

  // Memory sync-queue: proposals dropped by autonomous sessions, awaiting review.
  function queueSection() {
    const q = agents.queue && Array.isArray(agents.queue.pending) ? agents.queue.pending : [];
    const setup = agents.data && agents.data.setup ? agents.data.setup : {};
    const locations = setup.locations || {};
    const head = `
      <div class="home-card-head">
        <h3>Memory proposal location</h3>
        <span class="agents-queue-count${q.length ? " agents-queue-count--has" : ""}">${
          q.length ? q.length + " pending" : "none pending"
        }</span>
      </div>`;

    if (!q.length) {
      return `
        <section class="home-card agents-queue-card">
          ${head}
          <div class="home-card-body">
            <p class="home-empty">No pending proposals. Autonomous sessions drop durable learnings here for human review.</p>
            ${pathLine("queue", locations.memoryQueueDir || "memory/sync-queue")}
          </div>
        </section>`;
    }

    const items = q
      .map((p) => {
        const n = num(p.proposalCount);
        return `
          <div class="agents-queue-item">
            <div class="agents-queue-item-head">
              <span class="agents-queue-id">${esc(p.id)}</span>
              <span class="agents-queue-meta">${fmtInt(p.proposalCount)} proposal${n !== 1 ? "s" : ""}</span>
              <span class="agents-queue-path">${esc(p.path || `${locations.memoryQueueDir || "memory/sync-queue"}/${p.id}.md`)}</span>
            </div>
            <details class="agents-queue-details">
              <summary>view proposal</summary>
              <pre class="agents-queue-pre">${esc(p.content)}</pre>
            </details>
          </div>`;
      })
      .join("");

    return `
      <section class="home-card agents-queue-card">
        ${head}
        <div class="home-card-body">
          ${pathLine("queue", locations.memoryQueueDir || "memory/sync-queue")}
          ${items}
        </div>
      </section>`;
  }

  // -----------------------------------------------------------------------
  // Main render
  // -----------------------------------------------------------------------
  function render() {
    const root = $("#agents");
    if (!root) return;

    const data = agents.data;
    const agentList = data && Array.isArray(data.agents) ? data.agents : [];
    const setup = data && data.setup ? data.setup : null;
    const setupRoles = setup && Array.isArray(setup.roles) ? setup.roles : null;
    const usage = data && data.usage ? data.usage : {};
    const byRole = usage.byRole || {};
    const byModel = usage.byModel || {};
    const byEngine = usage.byEngine || {};
    const codexConfig = data && data.codex ? data.codex : {};

    const spendSection = `
      <div class="agents-spend-section">
        <section class="home-card agents-spend-card">
          <div class="home-card-head">
            <h3>Spend by model</h3>
          </div>
          <div class="home-card-body">
            ${spendTable(byModel, "model")}
          </div>
        </section>
        <section class="home-card agents-spend-card">
          <div class="home-card-head">
            <h3>Spend by role</h3>
          </div>
          <div class="home-card-body">
            ${spendTable(byRole, "role")}
          </div>
        </section>
        <section class="home-card agents-spend-card">
          <div class="home-card-head">
            <h3>Spend by engine</h3>
          </div>
          <div class="home-card-body">
            ${spendTable(byEngine, "engine")}
            <p class="panel-hint">Codex bills against your ChatGPT plan — tokens are tracked, cost shows n/a.</p>
          </div>
        </section>
      </div>`;

    const editorsHtml = agentList.length
      ? `<div class="agents-editor-grid">
           ${(setupRoles || agentList).map((a) => agentCard(a, byRole, codexConfig)).join("")}
         </div>`
      : `<p class="home-empty">No agents found. <span class="home-na">/api/agents</span> returned an empty list.</p>`;

    const emptyNotice = !data
      ? `<p class="agents-error home-empty"><span class="home-na">/api/agents</span> not available — check server.</p>`
      : "";

    root.innerHTML = `
      <div class="agents-view">
        <div class="agents-header">
          <h2 class="agents-title">Agents</h2>
          <button class="agents-refresh-btn" id="agents-refresh" type="button">Refresh</button>
        </div>
        ${emptyNotice}
        ${data ? setupOverview(setup) : ""}
        ${data ? editorsHtml : ""}
        ${data ? spendSection : ""}
        ${queueSection()}
      </div>`;

    // Wire Refresh button
    const refreshBtn = $("#agents-refresh");
    if (refreshBtn) refreshBtn.addEventListener("click", fetchAgents);

  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------
  function start() {
    if (agents.visible) return;
    agents.visible = true;
    fetchAgents();
    // Idle auto-refresh so finished runs / new proposals appear without a manual
    // Refresh — gated by busy() so it never disturbs an in-progress edit.
    agents.timer = setInterval(maybeRefresh, 15000);
  }

  function stop() {
    agents.visible = false;
    if (agents.timer) {
      clearInterval(agents.timer);
      agents.timer = null;
    }
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------
  window.agentsView = { start, stop };
})();
