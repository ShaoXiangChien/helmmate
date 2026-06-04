// Per-ticket git worktrees. Repos with `worktree: true` get an isolated checkout
// at helmmate/worktrees/<ticket>/<repo>. Repos with `worktree: false` run in
// place at their configured repo path.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { BOARD_DIR, REPOS } from "./paths.js";

export const WORKTREES_DIR = path.join(BOARD_DIR, "worktrees");

function isWorktreeRepo(repo) {
  return !!REPOS[repo]?.worktree;
}

function repoDir(repo) {
  return REPOS[repo]?.path || null;
}

// Where this ticket+repo worktree lives on disk.
function worktreePath(ticketId, repo) {
  return path.join(WORKTREES_DIR, ticketId, repo);
}

function git(cwd, args) {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    cwd,
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
    error: result.error ? result.error.message : null,
  };
}

// True when <branch> already exists as a local ref in repoDir.
function localBranchExists(dir, branch) {
  const res = git(dir, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
  return res.status === 0;
}

// True when <branch> exists on any configured remote. Best-effort: uses the
// already-fetched remote refs (no network) so a missing remote/no-fetch just
// reads as "not present" rather than blocking.
function remoteBranchExists(dir, branch) {
  const res = git(dir, ["for-each-ref", "--format=%(refname)", `refs/remotes/*/${branch}`]);
  if (res.status !== 0) return false;
  return res.stdout.length > 0;
}

// Inspect the worktree list to see if this path is already registered.
function worktreeRegistered(dir, wtPath) {
  const res = git(dir, ["worktree", "list", "--porcelain"]);
  if (res.status !== 0) return false;
  const resolved = path.resolve(wtPath);
  return res.stdout
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .some((line) => path.resolve(line.slice("worktree ".length).trim()) === resolved);
}

// ensureWorktree: create (or reuse) the isolated checkout for a ticket+repo.
//
// Returns one of:
//   { mode: "in-place", repo, path, baseBranch }     — configured no-worktree repo
//   { mode: "worktree", created, path, repo, branch, baseBranch }
//   { error, reason, repo, branch, ... }              — surfaced by the launcher
//
// Refuses if <branch> already exists locally or remotely unless { reuse: true }.
export function ensureWorktree({ repo, ticketId, branch, baseBranch, reuse = false } = {}) {
  if (!repo) return { error: "repo is required", reason: "bad_args" };
  if (!ticketId) return { error: "ticketId is required", reason: "bad_args" };
  const repoConfig = REPOS[repo];

  if (!repoConfig) {
    return { error: `unknown repo: ${repo}`, reason: "bad_repo", repo };
  }

  const effectiveBaseBranch = baseBranch || repoConfig.baseBranch || "main";
  if (!repoConfig.worktree) {
    return { mode: "in-place", repo, path: repoConfig.path, baseBranch: effectiveBaseBranch };
  }

  if (!branch) {
    return { error: "branch is required", reason: "bad_args", repo };
  }

  const dir = repoDir(repo);
  if (!dir || !fs.existsSync(dir)) {
    return { error: `repo checkout not found: ${dir}`, reason: "missing_repo", repo };
  }

  const wtPath = worktreePath(ticketId, repo);

  // If we've already built this exact worktree (e.g. a retry), reuse it as-is.
  if (worktreeRegistered(dir, wtPath) && fs.existsSync(wtPath)) {
    return {
      mode: "worktree",
      created: false,
      path: wtPath,
      repo,
      branch,
      baseBranch: effectiveBaseBranch,
    };
  }

  const existsLocal = localBranchExists(dir, branch);
  const existsRemote = remoteBranchExists(dir, branch);

  // Refuse to clobber an existing branch unless the caller opts into reuse.
  if ((existsLocal || existsRemote) && !reuse) {
    const where = [existsLocal && "local", existsRemote && "remote"].filter(Boolean).join("+");
    return {
      error: `branch already exists (${where}): ${branch} — pass { reuse: true } to use it`,
      reason: "branch_exists",
      repo,
      branch,
      existsLocal,
      existsRemote,
    };
  }

  // Make sure the parent dir exists (helmmate/worktrees/<ticket-id>).
  try {
    fs.mkdirSync(path.dirname(wtPath), { recursive: true });
  } catch (err) {
    return { error: `cannot create worktrees dir: ${err.message}`, reason: "mkdir_failed", repo };
  }

  // When reusing an existing branch, attach the worktree to it (no -b).
  // Otherwise create a new branch off the LATEST origin/<baseBranch>.
  //
  // The shared checkout's LOCAL base branch (e.g. `main`) is rarely checked out
  // or pulled, so it drifts behind origin. Branching a new ticket worktree off
  // that stale local ref is exactly what makes every fresh session re-hit
  // already-merged conflicts. So we fetch the base from origin first and branch
  // off `origin/<baseBranch>`. All git calls here are best-effort: an offline /
  // remoteless repo falls back to whatever ref we already have (origin/<base>
  // if previously fetched, else the local base branch) so a launch never hard-
  // fails just because the network is down.
  let args;
  let baseRef = effectiveBaseBranch;
  if (reuse && (existsLocal || existsRemote)) {
    if (existsLocal) {
      args = ["worktree", "add", wtPath, branch];
      baseRef = branch;
    } else {
      // Only the remote has it — freshen the remote ref, then track from it.
      git(dir, ["fetch", "origin", branch]);
      args = ["worktree", "add", "--track", "-b", branch, wtPath, `origin/${branch}`];
      baseRef = `origin/${branch}`;
    }
  } else {
    // Fetch the base branch so origin/<baseBranch> is current, then branch off
    // it. Fall back to the local base ref if origin/<baseBranch> isn't available.
    git(dir, ["fetch", "origin", effectiveBaseBranch]);
    const originBase = `origin/${effectiveBaseBranch}`;
    const haveOriginBase =
      git(dir, ["rev-parse", "--verify", "--quiet", `refs/remotes/${originBase}`]).status === 0;
    baseRef = haveOriginBase ? originBase : effectiveBaseBranch;
    args = ["worktree", "add", "-b", branch, wtPath, baseRef];
  }

  const res = git(dir, args);
  if (res.status !== 0) {
    return {
      error: `git worktree add failed: ${res.stderr || res.error || "unknown error"}`,
      reason: "worktree_add_failed",
      repo,
      branch,
      baseBranch: effectiveBaseBranch,
      baseRef,
    };
  }

  return {
    mode: "worktree",
    created: true,
    path: wtPath,
    repo,
    branch,
    baseBranch: effectiveBaseBranch,
    baseRef,
  };
}

// removeWorktree: detach and delete a single ticket+repo worktree. Best-effort;
// returns { removed, reason? }. In-place repos are a no-op.
export function removeWorktree(ticketId, repo) {
  if (REPOS[repo] && !isWorktreeRepo(repo)) return { removed: false, reason: "in-place" };
  if (!REPOS[repo]) return { removed: false, reason: "bad_repo" };

  const dir = repoDir(repo);
  if (!dir || !fs.existsSync(dir)) return { removed: false, reason: "missing_repo" };

  const wtPath = worktreePath(ticketId, repo);
  if (!worktreeRegistered(dir, wtPath) && !fs.existsSync(wtPath)) {
    return { removed: false, reason: "not_found" };
  }

  const res = git(dir, ["worktree", "remove", "--force", wtPath]);
  if (res.status !== 0) {
    return {
      removed: false,
      reason: "remove_failed",
      error: res.stderr || res.error || "unknown error",
    };
  }
  return { removed: true, path: wtPath };
}

// listWorktrees: every helmmate-managed worktree currently on disk, grouped by
// ticket. Reads the filesystem layout (helmmate/worktrees/<ticket-id>/<repo>) so it
// works even if a repo's git metadata is unhappy.
export function listWorktrees() {
  const out = [];
  let ticketDirs;
  try {
    ticketDirs = fs.readdirSync(WORKTREES_DIR, { withFileTypes: true });
  } catch {
    return out; // dir may not exist yet
  }
  for (const ticketEntry of ticketDirs) {
    if (!ticketEntry.isDirectory()) continue;
    const ticketId = ticketEntry.name;
    let repoDirs;
    try {
      repoDirs = fs.readdirSync(path.join(WORKTREES_DIR, ticketId), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const repoEntry of repoDirs) {
      if (!repoEntry.isDirectory()) continue;
      out.push({
        ticketId,
        repo: repoEntry.name,
        path: path.join(WORKTREES_DIR, ticketId, repoEntry.name),
      });
    }
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}
