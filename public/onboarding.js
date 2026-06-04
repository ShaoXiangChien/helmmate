// First-run onboarding overlay for new HelmMate users.

(function () {
  "use strict";

  const DISMISS_PREFIX = "helmmate.onboarding.dismissed.";
  let setup = null;

  const $ = (sel) => document.querySelector(sel);

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function getSetup() {
    try {
      const res = await fetch("/api/setup/status");
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  function dismissedKey() {
    return DISMISS_PREFIX + (setup?.activeProject || "default");
  }

  function isDismissed() {
    try {
      return localStorage.getItem(dismissedKey()) === "1";
    } catch {
      return false;
    }
  }

  function dismiss() {
    try {
      localStorage.setItem(dismissedKey(), "1");
    } catch {
      /* ignore */
    }
    const root = $("#onboarding");
    if (root) root.hidden = true;
  }

  async function initialize(btn) {
    if (btn) btn.disabled = true;
    await fetch("/api/setup/init", { method: "POST" }).catch(() => null);
    setup = await getSetup();
    render(true);
  }

  async function createTicket(btn) {
    const title = $("#onboarding-title")?.value.trim() || "First HelmMate ticket";
    const repo = setup?.repos?.[0] || "workspace";
    if (btn) btn.disabled = true;
    const res = await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        repo,
        priority: "P2",
        status: "triage",
        description: "Created from the onboarding overlay.",
        acceptance_criteria: ["Ticket appears on the board"],
      }),
    }).catch(() => null);
    if (res && res.ok) {
      dismiss();
      const refreshBtn = $("#refresh");
      if (refreshBtn) refreshBtn.click();
      if (window.helmmateSetView) window.helmmateSetView("board");
    } else {
      if (btn) btn.disabled = false;
    }
  }

  function step(ok, label, detail) {
    return `
      <li class="${ok ? "onboarding-step onboarding-step--done" : "onboarding-step"}">
        <span class="onboarding-dot"></span>
        <span class="onboarding-step-label">${esc(label)}</span>
        <span class="onboarding-step-detail">${esc(detail)}</span>
      </li>`;
  }

  function render(force = false) {
    const root = $("#onboarding");
    if (!root || !setup) return;
    const shouldShow = force || !setup.ready || setup.ticketCount === 0;
    if (!shouldShow || isDismissed()) return;

    root.hidden = false;
    root.innerHTML = `
      <div class="onboarding-backdrop"></div>
      <section class="onboarding-panel" role="dialog" aria-modal="true" aria-label="Set up HelmMate">
        <div class="onboarding-head">
          <div>
            <span class="onboarding-kicker">First run</span>
            <h2>Set up your local board</h2>
          </div>
          <button class="onboarding-close" id="onboarding-close" type="button" aria-label="Close">&times;</button>
        </div>
        <p class="onboarding-copy">
          HelmMate starts disarmed. Set up local folders, create a first ticket, then arm the board only when you want agent launches.
        </p>
        <ul class="onboarding-steps">
          ${step(!!setup.ticketsDirExists, "Tickets directory", setup.ticketsDir || "not configured")}
          ${step(!!setup.indexExists, "Ticket index", setup.indexExists ? "_index.json exists" : "will be created")}
          ${step((setup.repos || []).length > 0, "Configured repo", (setup.repos || []).join(", ") || "none")}
        </ul>
        <div class="onboarding-ticket-row">
          <input class="projects-input" id="onboarding-title" type="text" value="First HelmMate ticket" />
          <button class="projects-btn" id="onboarding-create" type="button">Create ticket</button>
        </div>
        <div class="onboarding-actions">
          <button class="projects-btn projects-btn--primary" id="onboarding-init" type="button">Initialize folders</button>
          <button class="projects-btn" id="onboarding-projects" type="button">Open Projects</button>
          <button class="projects-btn" id="onboarding-skip" type="button">Skip</button>
        </div>
      </section>`;

    $("#onboarding-close")?.addEventListener("click", dismiss);
    $("#onboarding-skip")?.addEventListener("click", dismiss);
    $("#onboarding-init")?.addEventListener("click", (e) => initialize(e.currentTarget));
    $("#onboarding-create")?.addEventListener("click", (e) => createTicket(e.currentTarget));
    $("#onboarding-projects")?.addEventListener("click", () => {
      dismiss();
      if (window.helmmateSetView) window.helmmateSetView("projects");
    });
  }

  async function init() {
    setup = await getSetup();
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
