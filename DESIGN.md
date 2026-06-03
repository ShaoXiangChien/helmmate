---
name: HelmMate
description: Local launch console for review-gated AI coding work.
colors:
  void-black: "#050914"
  console-navy: "#081224"
  panel-navy: "#0c1c34"
  panel-blue: "#0f2b4e"
  ink: "#e7f7ff"
  ink-soft: "#91b8ce"
  muted-steel: "#55758b"
  signal-cyan: "#4cc9ff"
  signal-cyan-hot: "#17f1ff"
  live-mint: "#2fffd0"
  tripwire-red: "#ff5f7a"
  p0-red: "#ff6b8a"
  queue-amber: "#ffd166"
  p2-steel: "#8aa6ba"
  log-cyan: "#9deaff"
  codex-violet: "#b48cff"
  codex-lavender: "#c7d2fe"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "clamp(42px, 7vw, 86px)"
    fontWeight: 700
    lineHeight: 0.96
    letterSpacing: "0"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.35
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.08em"
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "28px"
components:
  button-primary:
    backgroundColor: "{colors.signal-cyan-hot}"
    textColor: "{colors.void-black}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
    height: "38px"
  button-ghost:
    backgroundColor: "{colors.console-navy}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
  card:
    backgroundColor: "{colors.panel-navy}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px 13px"
  input:
    backgroundColor: "{colors.console-navy}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "9px 12px"
  chip:
    backgroundColor: "{colors.panel-navy}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.sm}"
    padding: "2px 7px"
---

# Design System: HelmMate

## 1. Overview

**Creative North Star: "The Launch Console"**

HelmMate is a sharp, local-first control surface for engineers steering bounded AI coding work. The visual system should feel dense, technical, and review-gated: closer to a launch console than a task manager, with state, risk, and readiness always visible.

The interface is dark by default because users operate it during focused engineering sessions with logs, branches, tickets, and process state in view. Cyan is the primary signal color, mint means safe or live, red means disarmed or dangerous, and amber means queued, costly, paused, or attention-worthy.

The system explicitly rejects fully autonomous company simulation, generic kanban softness, cheerful no-code setup language, glossy SaaS decoration, and ambiguous launch states. HelmMate earns trust by making the operational truth hard to miss.

**Key Characteristics:**
- Dark console surfaces with cyan grid/signal language.
- Compact control density for repeat engineering workflows.
- Monospace labels, IDs, paths, counts, and command previews.
- State colors that map directly to execution risk.
- Layered panels and cards with restrained glow, never decorative spectacle.

## 2. Colors

The palette is a cold technical console: near-black foundations, blue-navy panels, cyan signal accents, and semantic state colors for launch safety.

### Primary
- **Signal Cyan** (#4cc9ff): Default accent for section headers, borders, links, repo tags, and selected UI chrome.
- **Hot Signal Cyan** (#17f1ff): High-attention accent for active tabs, primary affordances, WIP values, running state, and focused controls.

### Secondary
- **Live Mint** (#2fffd0): Safe, armed, ready, completed, or Claude-engine state. Use when work is allowed or verified.
- **Codex Violet** (#b48cff): Codex-specific engine indicator. Use sparingly so it reads as a separate billing/execution path, not a general accent.

### Tertiary
- **Tripwire Red** (#ff5f7a): Disarmed, destructive, blocked, stop, error, and unsafe-launch state.
- **Queue Amber** (#ffd166): Queued, paused, warning, costly, or pending-review state.

### Neutral
- **Void Black** (#050914): Body background and deepest shell.
- **Console Navy** (#081224): secondary background, topbar fields, and form controls.
- **Panel Navy** (#0c1c34): cards, column bodies, and compact containers.
- **Panel Blue** (#0f2b4e): higher surface layer for gradients and hover depth.
- **Ink** (#e7f7ff): primary text.
- **Ink Soft** (#91b8ce): body support text and secondary labels.
- **Muted Steel** (#55758b): inactive labels, hints, empty states, and low-priority metadata.
- **P2 Steel** (#8aa6ba): low-priority or neutral status chips.
- **Log Cyan** (#9deaff): command previews and log text on near-black code surfaces.

### Named Rules

**The Signal Rarity Rule.** Cyan is for selection, focus, running state, and actionable affordances. Do not wash whole panels in cyan unless the panel is specifically about readiness or setup.

**The State Truth Rule.** Mint, red, and amber must map to actual product state. Do not use them as decoration.

## 3. Typography

**Display Font:** system sans stack with Apple / Segoe / Roboto fallbacks  
**Body Font:** system sans stack with Apple / Segoe / Roboto fallbacks  
**Label/Mono Font:** ui-monospace, SFMono-Regular, SF Mono, Menlo, monospace

**Character:** Product typography is compact and functional. Sans carries readable prose and panel headings; monospace carries operational facts: IDs, paths, model names, counts, statuses, commands, and labels.

### Hierarchy
- **Display** (700, clamp(42px, 7vw, 86px), 0.96): First-run onboarding hero only. Do not use display scale inside the cockpit shell.
- **Headline** (700, 24px, 1.2): Empty states, readiness summaries, and major first-run panels.
- **Title** (700, 17px, 1.35): Ticket panel headings and compact detail titles.
- **Body** (400, 13-14px, 1.45-1.6): Descriptions, helper copy, cards, lists, and side-panel prose. Keep prose blocks short and scannable.
- **Label** (700, 10-12px, 0.06-0.12em, uppercase): Section headers, tabs, status labels, form labels, and tiny operational metadata. Use monospace for the console feel.
- **Data** (700, 22-38px, 1): Usage counts, countdowns, and metric numerals. Always use monospace and tabular numerals.

### Named Rules

**The Operational Mono Rule.** Use monospace for facts a user may compare or copy: ticket IDs, paths, repo keys, commands, models, status labels, and numbers. Do not use monospace for long explanatory prose.

## 4. Elevation

HelmMate uses a hybrid of tonal layering and glow. Base surfaces are separated by dark blue opacity, 1px cyan-tinted borders, and inset light. Shadows appear on cards, side panels, toasts, active states, and draggable objects where depth clarifies interaction.

### Shadow Vocabulary
- **Panel Shadow** (`0 0 0 1px rgba(76, 201, 255, 0.08), 0 16px 40px rgba(0, 0, 0, 0.38)`): Default card and column depth.
- **Signal Glow** (`0 0 22px rgba(23, 241, 255, 0.18)`): Hover and focus emphasis for interactive controls.
- **Topbar Shadow** (`0 1px 0 rgba(23, 241, 255, 0.12), 0 18px 50px rgba(0, 0, 0, 0.3)`): Sticky header separation.
- **Drawer Shadow** (`-20px 0 60px rgba(0,0,0,0.48), -1px 0 24px rgba(23,241,255,0.14)`): Right-side ticket panel.
- **Drag Shadow** (`0 18px 44px rgba(0,0,0,0.6), 0 0 28px rgba(23,241,255,0.22)`): Sortable drag state only.

### Named Rules

**The Glow Means State Rule.** Glow is allowed for hover, focus, active, running, armed, and drag states. Do not use glow as idle ornament.

## 5. Components

Components are compact control surfaces: squared-off enough to feel precise, softly rounded enough for touch targets, and visually consistent across Board, Home, Agents, Projects, and Onboarding.

### Buttons
- **Shape:** compact rectangular controls with an 8px radius.
- **Primary:** cyan or mint-tinted surface, 1px border, 8-14px horizontal padding, bold label, and no large drop shadow at rest.
- **Hover / Focus:** shift border toward `--line-strong` or `--accent-2`, brighten text to `--ink`, and add signal glow only when state feedback matters.
- **Secondary / Ghost:** dark navy fill with `--ink-soft` text and cyan-tinted border. Use for repeat actions like refresh, import, copy, and toggle.
- **Danger:** red tint with `--disarmed` text. Use for stop, delete, blocked, and unsafe actions.

### Chips
- **Style:** 6px radius, 1px border, tiny monospace or bold label, 2-8px padding.
- **State:** mint for ready/done, red for blocked/disarmed, cyan for running/active, amber for queued/paused/warning, steel for low-priority or inactive metadata.

### Cards / Containers
- **Corner Style:** 8px radius.
- **Background:** `--surface-2` for dashboard cards; ticket cards use a navy vertical gradient from active panel blue to deep console navy.
- **Shadow Strategy:** use Panel Shadow plus a subtle inset cyan wash. On hover, increase border contrast and add signal glow.
- **Border:** 1px cyan-tinted borders. Avoid thick side-stripe status accents.
- **Internal Padding:** 12-18px for compact cards; 24-30px for first-run onboarding panels.

### Inputs / Fields
- **Style:** dark navy fill, 1px cyan-tinted border, 8px radius, 9-12px padding, ink text.
- **Focus:** no default outline; border shifts to hot cyan and uses a thin cyan glow ring.
- **Error / Disabled:** red text for field errors; disabled controls lower opacity to 0.5 and remove shadow.
- **Mobile:** form controls should be 16px at phone sizes to avoid iOS focus zoom.

### Navigation
- **Sidebar:** sticky left rail on desktop, dark near-black background, 208px width, uppercase mono tabs, active tab with cyan tint and glow.
- **Mobile:** sidebar collapses into a top horizontal rail. Board columns stack to one column and the ticket panel becomes full-screen.
- **Topbar:** sticky control strip with compact buttons and state toggles. It should feel like cockpit chrome, not marketing navigation.

### Ticket Cards

Ticket cards are the signature work unit. They use a dark navy gradient, compact metadata rows, state badges, and optional resume/stop actions. Hover should reveal affordance with border/glow, but the card must remain readable at rest.

### Side Panel

The side panel is the review surface. It uses a right-side drawer on desktop, full-screen panel on phones, and denser content blocks for launch preview, acceptance criteria, context refs, notes, logs, and ticket edits.

### Onboarding Gate

The onboarding gate may be more dramatic than the main cockpit: large hero type, subtle animated background lines, and a larger setup panel. It still uses the same tokens, state colors, and compact form vocabulary.

## 6. Do's and Don'ts

### Do:
- **Do** keep HelmMate product-first: dense, technical, controlled, and honest about risk.
- **Do** use `#17f1ff` and `#4cc9ff` for signal, focus, running, active, and primary action states.
- **Do** use `#2fffd0`, `#ff5f7a`, and `#ffd166` only when they communicate true state.
- **Do** preserve 8px radii for cards, panels, buttons, inputs, and compact containers.
- **Do** use monospace for ticket IDs, repo keys, paths, models, commands, counters, status labels, and form labels.
- **Do** make WIP, launch readiness, disarmed state, blockers, logs, and review status agree across the UI.
- **Do** provide readable contrast, visible focus, keyboard-operable controls, semantic labels, and reduced-motion alternatives.

### Don't:
- **Don't** make HelmMate look or sound like a fully autonomous company simulator.
- **Don't** use generic kanban clone styling, cheerful no-code workflow language, or glossy SaaS landing-page decoration inside the app shell.
- **Don't** imply zero-human operation, agents as employees, org-chart theater, replacing engineering judgment, or business-wide automation.
- **Don't** use soft motivational copy, decorative dashboard drama, or ambiguous launch states that make queued, blocked, and running work feel interchangeable.
- **Don't** use thick `border-left` or `border-right` status stripes. Use badges, full borders, state text, or iconography instead.
- **Don't** use gradient text, glass cards as decoration, or repeated identical icon-card grids.
- **Don't** pair 1px borders with wide decorative drop shadows on every element. Use glow when state changes, not as a default flourish.
- **Don't** invent unusual controls for standard tasks. Product UI should feel familiar enough that engineers trust it immediately.
