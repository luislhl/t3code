/**
 * Fork builds only. The fork's `fork-sync.yml` workflow rebases the fork's
 * patches onto upstream and publishes a release for each upstream release.
 * When it fails, updates silently stop, so the app surfaces its state.
 * Builds without `VITE_T3CODE_FORK_REPOSITORY` never check.
 */
export const FORK_SYNC_REPOSITORY =
  (import.meta.env.VITE_T3CODE_FORK_REPOSITORY as string | undefined)?.trim() || null;

const FORK_SYNC_WORKFLOW = "fork-sync.yml";
// The workflow runs hourly. GitHub delays and skips scheduled runs under load,
// and disables schedules on repositories without recent activity.
const FORK_SYNC_STALE_AFTER_MS = 12 * 60 * 60 * 1000;
const FAILED_CONCLUSIONS = new Set(["failure", "timed_out", "startup_failure", "action_required"]);

export interface ForkSyncRun {
  readonly conclusion: string | null;
  readonly html_url: string;
  readonly updated_at: string;
}

export type ForkSyncStatus =
  | { readonly kind: "ok" }
  | { readonly kind: "failed"; readonly url: string; readonly at: string }
  | { readonly kind: "stale"; readonly url: string; readonly at: string | null };

export function forkSyncWorkflowUrl(repository: string): string {
  return `https://github.com/${repository}/actions/workflows/${FORK_SYNC_WORKFLOW}`;
}

export function resolveForkSyncStatus(input: {
  readonly repository: string;
  readonly latestRun: ForkSyncRun | null;
  readonly now: number;
}): ForkSyncStatus {
  const { latestRun } = input;
  if (latestRun === null) {
    return { kind: "stale", url: forkSyncWorkflowUrl(input.repository), at: null };
  }
  if (latestRun.conclusion !== null && FAILED_CONCLUSIONS.has(latestRun.conclusion)) {
    return { kind: "failed", url: latestRun.html_url, at: latestRun.updated_at };
  }
  const finishedAt = Date.parse(latestRun.updated_at);
  if (Number.isNaN(finishedAt) || input.now - finishedAt > FORK_SYNC_STALE_AFTER_MS) {
    return {
      kind: "stale",
      url: forkSyncWorkflowUrl(input.repository),
      at: latestRun.updated_at,
    };
  }
  return { kind: "ok" };
}

/** Reads the latest completed sync run. Null when GitHub cannot be reached. */
export async function fetchForkSyncStatus(repository: string): Promise<ForkSyncStatus | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/actions/workflows/${FORK_SYNC_WORKFLOW}/runs?status=completed&per_page=1`,
      { headers: { Accept: "application/vnd.github+json" } },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { readonly workflow_runs?: ReadonlyArray<ForkSyncRun> };
    return resolveForkSyncStatus({
      repository,
      latestRun: body.workflow_runs?.[0] ?? null,
      now: Date.now(),
    });
  } catch {
    return null;
  }
}
