// HelmMate Projects view — setup assistant + project registry editor.

(function () {
  "use strict";

  const projects = {
    visible: false,
    data: null,
    setup: null,
    selectedId: null,
    advancedOpen: false,
  };

  const $ = (sel) => document.querySelector(sel);

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function projectIds() {
    return projects.data && projects.data.projects ? Object.keys(projects.data.projects) : [];
  }

  function selectedProject() {
    const id = projects.selectedId || projects.data?.activeProject || projectIds()[0] || "default";
    return {
      id,
      project: projects.data?.projects?.[id] || {},
    };
  }

  async function getJSON(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async function refresh() {
    const [data, setup] = await Promise.all([
      getJSON("/api/projects"),
      getJSON("/api/setup/status"),
    ]);
    projects.data = data;
    projects.setup = setup;
    if (!projects.selectedId) projects.selectedId = data?.activeProject || data?.runtimeActiveProject || projectIds()[0] || "default";
    render();
  }

  async function initializeProject(btn) {
    if (btn) btn.disabled = true;
    try {
      await fetch("/api/setup/init", { method: "POST" });
    } finally {
      await refresh();
    }
  }

  async function createStarterTicket(btn) {
    const input = $("#projects-starter-title");
    const title = input && input.value.trim() ? input.value.trim() : "First HelmMate ticket";
    const repo = projects.setup?.repos?.[0] || "workspace";
    if (btn) btn.disabled = true;
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          repo,
          priority: "P2",
          status: "triage",
          description: "Created from the HelmMate onboarding flow.",
          acceptance_criteria: ["Ticket appears on the board"],
        }),
      });
      if (res.ok) {
        const refreshBtn = $("#refresh");
        if (refreshBtn) refreshBtn.click();
        if (window.devboardSetView) window.devboardSetView("board");
      }
    } finally {
      await refresh();
    }
  }

  function slugId(value, fallback = "project") {
    const slug = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
    return slug || fallback;
  }

  function quickValues() {
    const name = $("#projects-quick-name")?.value.trim() || "";
    const path = $("#projects-quick-path")?.value.trim() || ".";
    const id = $("#projects-quick-id")?.value.trim() || slugId(name || path.split("/").filter(Boolean).pop(), "default");
    return {
      id,
      name: name || id,
      workspaceDir: path,
      ticketIdPrefix: ($("#projects-quick-prefix")?.value.trim() || "DB").toUpperCase(),
    };
  }

  function quickPayload(mode) {
    const q = quickValues();
    return {
      name: q.name,
      workspaceDir: q.workspaceDir,
      ticketsDir: "tickets",
      ticketIdPrefix: q.ticketIdPrefix,
      agentDir: ".agents",
      memoryQueueDir: "memory/sync-queue",
      workPrompt: "scripts/work-ticket-prompt.md",
      fixCiPrompt: "scripts/fix-ci-prompt.md",
      fixConflictPrompt: "scripts/fix-conflict-prompt.md",
      statuses: ["triage", "backlog", "queued", "in_progress", "blocked", "human_review", "done"],
      repos: {
        workspace: {
          path: ".",
          baseBranch: "main",
          worktree: false,
          role: "cross-repo",
        },
      },
      engines: { default: "claude", allowed: ["claude", "codex"] },
    };
  }

  async function saveQuickProject(mode, btn) {
    const q = quickValues();
    if (!q.id) return setStatus("Project id is required.", "bad");
    if (btn) btn.disabled = true;
    const res = await fetch(`/api/projects/${encodeURIComponent(q.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(quickPayload(mode)),
    });
    if (res.ok) {
      projects.data = await res.json();
      projects.selectedId = q.id;
      setStatus(mode === "new" ? "New project defaults saved." : "Existing repo imported.", "ok");
    } else {
      const e = await res.json().catch(() => ({}));
      setStatus(e.error || `Save failed (${res.status})`, "bad");
    }
    if (btn) btn.disabled = false;
    render();
  }

  async function copyAgentPrompt(btn) {
    const q = quickValues();
    if (btn) btn.disabled = true;
    try {
      const res = await fetch("/api/setup/agent-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "existing",
          projectId: q.id,
          name: q.name,
          workspaceDir: q.workspaceDir,
          ticketIdPrefix: q.ticketIdPrefix,
        }),
      });
      const data = await res.json();
      await navigator.clipboard.writeText(data.prompt || "");
      setStatus("Copied setup prompt.", "ok");
    } catch {
      setStatus("Could not copy setup prompt.", "bad");
    }
    if (btn) btn.disabled = false;
  }

  async function saveSelected(btn) {
    const id = $("#projects-id")?.value.trim();
    if (!id) return setStatus("Project id is required.", "bad");

    let repos;
    try {
      repos = JSON.parse($("#projects-repos")?.value || "{}");
    } catch {
      return setStatus("Repos must be valid JSON.", "bad");
    }

    const statuses = ($("#projects-statuses")?.value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    const payload = {
      name: $("#projects-name")?.value.trim() || id,
      workspaceDir: $("#projects-workspace")?.value.trim() || ".",
      ticketsDir: $("#projects-tickets")?.value.trim() || "tickets",
      ticketIdPrefix: $("#projects-prefix")?.value.trim() || "DB",
      agentDir: $("#projects-agents")?.value.trim() || ".agents",
      memoryQueueDir: $("#projects-memory")?.value.trim() || "memory/sync-queue",
      workPrompt: $("#projects-work-prompt")?.value.trim() || "scripts/work-ticket-prompt.md",
      fixCiPrompt: $("#projects-ci-prompt")?.value.trim() || "scripts/fix-ci-prompt.md",
      fixConflictPrompt: $("#projects-conflict-prompt")?.value.trim() || "scripts/fix-conflict-prompt.md",
      statuses: statuses.length ? statuses : ["triage", "backlog", "queued", "in_progress", "blocked", "human_review", "done"],
      repos,
    };

    if (btn) btn.disabled = true;
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      projects.data = await res.json();
      projects.selectedId = id;
      setStatus("Saved project config.", "ok");
    } else {
      const e = await res.json().catch(() => ({}));
      setStatus(e.error || `Save failed (${res.status})`, "bad");
    }
    if (btn) btn.disabled = false;
    render();
  }

  async function activateSelected() {
    const id = selectedProject().id;
    const res = await fetch("/api/projects/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      projects.data = await res.json();
      setStatus("Active project saved. Restart the server to load its paths.", "warn");
    } else {
      const e = await res.json().catch(() => ({}));
      setStatus(e.error || `Switch failed (${res.status})`, "bad");
    }
    render();
  }

  async function deleteSelected() {
    const id = selectedProject().id;
    if (!confirm(`Delete project config "${id}"?`)) return;
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) {
      projects.data = await res.json();
      projects.selectedId = projects.data.activeProject || projectIds()[0] || "default";
    } else {
      const e = await res.json().catch(() => ({}));
      setStatus(e.error || `Delete failed (${res.status})`, "bad");
    }
    render();
  }

  function setStatus(message, tone = "") {
    const el = $("#projects-status");
    if (!el) return;
    el.textContent = message;
    el.className = `projects-status ${tone ? `projects-status--${tone}` : ""}`;
  }

  function setupCard() {
    const s = projects.setup || {};
    const step = (ok, label, detail) => `
      <li class="${ok ? "projects-step projects-step--done" : "projects-step"}">
        <span class="projects-step-dot"></span>
        <span class="projects-step-main">${esc(label)}</span>
        <span class="projects-step-detail">${esc(detail)}</span>
      </li>`;

    return `
      <section class="home-card projects-setup-card">
        <div class="home-card-head">
          <h3>Setup assistant</h3>
          <span class="home-card-sub">${s.ready ? "ready" : "needs setup"}</span>
        </div>
        <div class="home-card-body">
          <ul class="projects-steps">
            ${step(!!s.ticketsDirExists, "Tickets directory", s.ticketsDir || "not configured")}
            ${step(!!s.indexExists, "Ticket index", s.indexExists ? "_index.json exists" : "will be created")}
            ${step((s.repos || []).length > 0, "Configured repo", (s.repos || []).join(", ") || "none")}
            ${step(!!s.agentDirExists, "Agent directory", s.agentDir || "not configured")}
            ${step(!!s.memoryQueueDirExists, "Memory queue", s.memoryQueueDir || "not configured")}
          </ul>
          <div class="projects-actions">
            <button class="projects-btn projects-btn--primary" id="projects-init" type="button">Initialize folders</button>
            <input class="projects-input projects-starter-input" id="projects-starter-title" type="text" value="First HelmMate ticket" />
            <button class="projects-btn" id="projects-create-ticket" type="button">Create starter ticket</button>
          </div>
        </div>
      </section>`;
  }

  function guidedSetupCard() {
    const { id, project } = selectedProject();
    const path = project.workspaceDir || ".";
    return `
      <section class="home-card projects-guided-card">
        <div class="home-card-head">
          <h3>Guided setup</h3>
          <span class="home-card-sub">quick start</span>
        </div>
        <div class="home-card-body">
          <div class="projects-form-grid projects-quick-grid">
            ${field("Project ID", "projects-quick-id", id || "default")}
            ${field("Name", "projects-quick-name", project.name || id || "Default")}
            ${field("Workspace path", "projects-quick-path", path)}
            ${field("Ticket prefix", "projects-quick-prefix", project.ticketIdPrefix || "DB")}
          </div>
          <div class="projects-flow-grid">
            <div class="projects-flow">
              <span class="projects-flow-kicker">Existing repo</span>
              <span class="projects-flow-main">Import repo defaults</span>
              <button class="projects-btn projects-btn--primary" id="projects-import-existing" type="button">Import existing repo</button>
            </div>
            <div class="projects-flow">
              <span class="projects-flow-kicker">New project</span>
              <span class="projects-flow-main">Create clean defaults</span>
              <button class="projects-btn" id="projects-save-new" type="button">Save new project</button>
            </div>
            <div class="projects-flow projects-flow--agent">
              <span class="projects-flow-kicker">Agent setup</span>
              <span class="projects-flow-main">Use helm-setup-project</span>
              <button class="projects-btn" id="projects-copy-setup" type="button">Copy setup prompt</button>
            </div>
          </div>
          <p class="projects-note">Advanced config stays below for multi-repo projects, custom prompts, and nonstandard statuses.</p>
          <span class="projects-status" id="projects-status"></span>
        </div>
      </section>`;
  }

  function projectList() {
    const ids = projectIds();
    if (!ids.length) return `<p class="home-empty">No projects found.</p>`;
    return `
      <div class="projects-list">
        ${ids
          .map((id) => {
            const p = projects.data.projects[id] || {};
            const active = id === projects.data.activeProject;
            const runtime = id === projects.data.runtimeActiveProject;
            return `
              <button class="projects-list-item${id === selectedProject().id ? " projects-list-item--selected" : ""}" type="button" data-project-id="${esc(id)}">
                <span class="projects-list-name">${esc(p.name || id)}</span>
                <span class="projects-list-meta">${esc(id)}${active ? " · selected" : ""}${runtime ? " · running" : ""}</span>
              </button>`;
          })
          .join("")}
      </div>`;
  }

  function editor() {
    const { id, project } = selectedProject();
    const statuses = Array.isArray(project.statuses) ? project.statuses.join(", ") : "triage, backlog, queued, in_progress, blocked, human_review, done";
    const repos = project.repos || { workspace: { path: ".", baseBranch: "main", worktree: false, role: "cross-repo" } };
    return `
      <section class="home-card projects-editor-card">
        <div class="home-card-head">
          <h3>Advanced config</h3>
          <button class="projects-link-btn" id="projects-advanced-toggle" type="button">${projects.advancedOpen ? "Hide" : "Show"}</button>
        </div>
        <div class="home-card-body"${projects.advancedOpen ? "" : " hidden"}>
          <div class="projects-form-grid">
            ${field("Project ID", "projects-id", id)}
            ${field("Name", "projects-name", project.name || id)}
            ${field("Workspace", "projects-workspace", project.workspaceDir || ".")}
            ${field("Tickets", "projects-tickets", project.ticketsDir || "tickets")}
            ${field("Ticket prefix", "projects-prefix", project.ticketIdPrefix || "DB")}
            ${field("Agent dir", "projects-agents", project.agentDir || ".agents")}
            ${field("Memory queue", "projects-memory", project.memoryQueueDir || "memory/sync-queue")}
            ${field("Work prompt", "projects-work-prompt", project.workPrompt || "scripts/work-ticket-prompt.md")}
            ${field("CI prompt", "projects-ci-prompt", project.fixCiPrompt || "scripts/fix-ci-prompt.md")}
            ${field("Conflict prompt", "projects-conflict-prompt", project.fixConflictPrompt || "scripts/fix-conflict-prompt.md")}
          </div>
          <label class="projects-label" for="projects-statuses">Statuses</label>
          <input class="projects-input" id="projects-statuses" type="text" value="${esc(statuses)}" />
          <label class="projects-label" for="projects-repos">Repos JSON</label>
          <textarea class="projects-textarea" id="projects-repos" rows="10">${esc(JSON.stringify(repos, null, 2))}</textarea>
          <div class="projects-actions">
            <button class="projects-btn projects-btn--primary" id="projects-save" type="button">Save project</button>
            <button class="projects-btn" id="projects-activate" type="button">Set active</button>
            <button class="projects-btn projects-btn--danger" id="projects-delete" type="button">Delete</button>
            <button class="projects-btn" id="projects-new" type="button">New blank project</button>
          </div>
        </div>
      </section>`;
  }

  function field(label, id, value) {
    return `
      <label class="projects-field">
        <span class="projects-label">${esc(label)}</span>
        <input class="projects-input" id="${esc(id)}" type="text" value="${esc(value)}" />
      </label>`;
  }

  function restartBanner() {
    if (!projects.data?.requiresRestartToSwitch) return "";
    return `
      <div class="home-breaker projects-restart">
        <div class="home-breaker-main">
          <span class="home-breaker-flag">Restart needed</span>
          <span class="home-breaker-reason">The selected active project differs from the project currently loaded by the server.</span>
        </div>
      </div>`;
  }

  function render() {
    const root = $("#projects");
    if (!root) return;
    root.innerHTML = `
      <div class="projects-view">
        <div class="agents-header">
          <h2 class="agents-title">Projects</h2>
          <button class="agents-refresh-btn" id="projects-refresh" type="button">Refresh</button>
        </div>
        ${restartBanner()}
        ${guidedSetupCard()}
        ${setupCard()}
        <div class="projects-grid">
          <section class="home-card projects-list-card">
            <div class="home-card-head"><h3>Project registry</h3></div>
            <div class="home-card-body">${projectList()}</div>
          </section>
          ${editor()}
        </div>
      </div>`;

    $("#projects-refresh")?.addEventListener("click", refresh);
    $("#projects-init")?.addEventListener("click", (e) => initializeProject(e.currentTarget));
    $("#projects-create-ticket")?.addEventListener("click", (e) => createStarterTicket(e.currentTarget));
    $("#projects-import-existing")?.addEventListener("click", (e) => saveQuickProject("existing", e.currentTarget));
    $("#projects-save-new")?.addEventListener("click", (e) => saveQuickProject("new", e.currentTarget));
    $("#projects-copy-setup")?.addEventListener("click", (e) => copyAgentPrompt(e.currentTarget));
    $("#projects-advanced-toggle")?.addEventListener("click", () => {
      projects.advancedOpen = !projects.advancedOpen;
      render();
    });
    $("#projects-save")?.addEventListener("click", (e) => saveSelected(e.currentTarget));
    $("#projects-activate")?.addEventListener("click", activateSelected);
    $("#projects-delete")?.addEventListener("click", deleteSelected);
    $("#projects-new")?.addEventListener("click", () => {
      projects.selectedId = `project-${projectIds().length + 1}`;
      render();
    });
    root.querySelectorAll(".projects-list-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        projects.selectedId = btn.getAttribute("data-project-id");
        render();
      });
    });
  }

  function start() {
    if (projects.visible) return;
    projects.visible = true;
    refresh();
  }

  function stop() {
    projects.visible = false;
  }

  window.projectsView = { start, stop, refresh };
})();
