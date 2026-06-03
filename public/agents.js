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
    dirty: false, // true when an editor field has unsaved edits
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

  // Auto-refresh the spend/queue on a gentle cadence, but NEVER while the user
  // is mid-interaction — skip if an editor field is focused, there are unsaved
  // edits, or a proposal is expanded (so a refresh can't clobber or collapse it).
  function busy() {
    const root = $("#agents");
    if (!root) return true;
    if (agents.dirty) return true;
    const ae = document.activeElement;
    if (ae && root.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return true;
    if (root.querySelector("details[open]")) return true;
    return false;
  }

  function maybeRefresh() {
    if (!agents.visible || busy()) return;
    fetchAgents();
  }

  // Resolve a pending memory proposal (archive = applied; dismiss = skipped).
  async function resolveQueue(id, action, btn) {
    const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, "_");
    const statusEl = $(`#agents-queue-status-${CSS.escape(safe)}`);
    if (btn) btn.disabled = true;
    try {
      const res = await fetch(`/api/memory-queue/${encodeURIComponent(id)}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        fetchAgents(); // re-fetch so the resolved item drops out of the list
        return;
      }
      let msg = `HTTP ${res.status}`;
      try {
        const e = await res.json();
        if (e && e.error) msg = e.error;
      } catch {
        // ignore
      }
      if (statusEl) {
        statusEl.textContent = `error: ${msg}`;
        statusEl.className = "agents-status agents-status--err";
      }
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = `error: ${err && err.message ? err.message : "network"}`;
        statusEl.className = "agents-status agents-status--err";
      }
    }
    if (btn) btn.disabled = false;
  }

  function setRefreshState(loading) {
    const btn = $("#agents-refresh");
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading ? "Loading…" : "Refresh";
  }

  // -----------------------------------------------------------------------
  // Save a single agent (PUT /api/agents/:role)
  // -----------------------------------------------------------------------
  async function saveAgent(role, statusEl, saveBtn) {
    const descInput = $(`#agents-desc-${CSS.escape(role)}`);
    const modelSel = $(`#agents-model-${CSS.escape(role)}`);
    const bodyTA = $(`#agents-body-${CSS.escape(role)}`);

    if (!descInput || !modelSel || !bodyTA) return;

    const payload = {
      description: descInput.value,
      model: modelSel.value,
      body: bodyTA.value,
    };

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    statusEl.textContent = "";
    statusEl.className = "agents-status";

    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(role)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const updated = await res.json();
        // Patch the in-memory data so other cards are not blown away.
        if (agents.data && Array.isArray(agents.data.agents)) {
          const idx = agents.data.agents.findIndex((a) => a.role === role);
          if (idx !== -1 && updated.agent) {
            agents.data.agents[idx] = updated.agent;
          }
        }
        statusEl.textContent = "saved ✓";
        statusEl.className = "agents-status agents-status--ok";
        agents.dirty = false; // edits persisted — idle auto-refresh may resume
      } else {
        let msg = `HTTP ${res.status}`;
        try {
          const e = await res.json();
          if (e && e.error) msg = e.error;
        } catch {
          // ignore
        }
        statusEl.textContent = `error: ${msg}`;
        statusEl.className = "agents-status agents-status--err";
      }
    } catch (err) {
      statusEl.textContent = `error: ${err && err.message ? err.message : "network error"}`;
      statusEl.className = "agents-status agents-status--err";
    }

    saveBtn.disabled = false;
    saveBtn.textContent = "Save";
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

  // One editable agent card
  function agentCard(agent, usageByRole, codexConfig) {
    const role = agent.role || "unknown";
    const safeId = role.replace(/[^a-zA-Z0-9_-]/g, "_");
    const roleUsage = usageByRole && usageByRole[role] ? usageByRole[role] : null;
    const codexModel = codexConfig && codexConfig.modelByRole ? codexConfig.modelByRole[role] : null;
    const codexEffort = codexConfig && codexConfig.effortByRole ? codexConfig.effortByRole[role] : null;

    const runsLine = roleUsage
      ? `${fmtInt(roleUsage.runs)} run${num(roleUsage.runs) !== 1 ? "s" : ""} · ${fmtUSD(roleUsage.cost_usd, roleUsage.has_cost)}`
      : "no runs yet";

    const modelOptions = ["sonnet", "opus", "haiku"]
      .map((m) => {
        const sel = (agent.model || "").toLowerCase().includes(m) ? " selected" : "";
        return `<option value="${esc(m)}"${sel}>${esc(m)}</option>`;
      })
      .join("");

    return `
      <section class="home-card agents-editor-card">
        <div class="home-card-head">
          <h3>${esc(role)}</h3>
          ${modelBadge(agent.model)}
        </div>
        <div class="home-card-body">
          <div class="agents-runs-line">${esc(runsLine)}</div>
          ${
            codexModel
              ? `<div class="agents-codex-line">Codex default: <span>${esc(codexModel)}</span> · <span>${esc(codexEffort || "medium")}</span></div>`
              : ""
          }

          <div class="agents-field-row">
            <label class="agents-label" for="agents-model-${esc(safeId)}">model</label>
            <select class="agents-select" id="agents-model-${esc(safeId)}" name="model">
              ${modelOptions}
            </select>
          </div>

          <div class="agents-field-col">
            <label class="agents-label" for="agents-desc-${esc(safeId)}">description</label>
            <input
              class="agents-input"
              id="agents-desc-${esc(safeId)}"
              type="text"
              value="${esc(agent.description || "")}"
              placeholder="One-line persona description…"
            />
          </div>

          <div class="agents-field-col">
            <label class="agents-label" for="agents-body-${esc(safeId)}">body</label>
            <textarea
              class="agents-textarea"
              id="agents-body-${esc(safeId)}"
              rows="14"
              placeholder="Markdown body (everything after frontmatter)…"
            >${esc(agent.body || "")}</textarea>
          </div>

          <div class="agents-save-row">
            <button
              class="agents-save-btn"
              type="button"
              data-role="${esc(role)}"
            >Save</button>
            <span
              class="agents-status"
              id="agents-status-${esc(safeId)}"
            ></span>
          </div>

          <div class="agents-path home-note">${esc(agent.path || "")}</div>
        </div>
      </section>`;
  }

  // Memory sync-queue: proposals dropped by autonomous sessions, awaiting review.
  function queueSection() {
    const q = agents.queue && Array.isArray(agents.queue.pending) ? agents.queue.pending : [];
    const head = `
      <div class="home-card-head">
        <h3>Memory proposals</h3>
        <span class="agents-queue-count${q.length ? " agents-queue-count--has" : ""}">${
          q.length ? q.length + " pending" : "none pending"
        }</span>
      </div>`;

    if (!q.length) {
      return `
        <section class="home-card agents-queue-card">
          ${head}
          <div class="home-card-body">
            <p class="home-empty">No pending proposals. Autonomous sessions drop durable learnings in
            <span class="home-na">memory/sync-queue/</span> for review; they appear here.</p>
          </div>
        </section>`;
    }

    const items = q
      .map((p) => {
        const safe = String(p.id).replace(/[^a-zA-Z0-9_-]/g, "_");
        const n = num(p.proposalCount);
        return `
          <div class="agents-queue-item">
            <div class="agents-queue-item-head">
              <span class="agents-queue-id">${esc(p.id)}</span>
              <span class="agents-queue-meta">${fmtInt(p.proposalCount)} proposal${n !== 1 ? "s" : ""}</span>
              <span class="agents-queue-actions">
                <button class="agents-queue-btn" data-id="${esc(p.id)}" data-action="archive"
                  title="I applied this by hand — move to applied/">Archive</button>
                <button class="agents-queue-btn agents-queue-btn--dismiss" data-id="${esc(p.id)}" data-action="dismiss"
                  title="Skip — delete the proposal">Dismiss</button>
              </span>
              <span class="agents-status" id="agents-queue-status-${esc(safe)}"></span>
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
        <div class="home-card-body">${items}</div>
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
           ${agentList.map((a) => agentCard(a, byRole, codexConfig)).join("")}
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
        ${queueSection()}
        ${data ? spendSection : ""}
        ${data ? editorsHtml : ""}
      </div>`;

    // Wire Refresh button
    const refreshBtn = $("#agents-refresh");
    if (refreshBtn) refreshBtn.addEventListener("click", fetchAgents);

    // Wire memory-queue Archive/Dismiss buttons
    root.querySelectorAll(".agents-queue-btn").forEach((btn) => {
      btn.addEventListener("click", () =>
        resolveQueue(btn.getAttribute("data-id"), btn.getAttribute("data-action"), btn)
      );
    });

    // Mark dirty on any editor edit so idle auto-refresh pauses until you save.
    root.querySelectorAll(".agents-input, .agents-textarea, .agents-select").forEach((el) => {
      el.addEventListener("input", () => { agents.dirty = true; });
      el.addEventListener("change", () => { agents.dirty = true; });
    });

    // Wire Save buttons — each button carries its role in data-role
    root.querySelectorAll(".agents-save-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const role = btn.getAttribute("data-role");
        const safeId = role.replace(/[^a-zA-Z0-9_-]/g, "_");
        const statusEl = $(`#agents-status-${CSS.escape(safeId)}`);
        saveAgent(role, statusEl, btn);
      });
    });
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
