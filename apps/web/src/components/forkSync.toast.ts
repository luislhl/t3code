import { FORK_SYNC_REPOSITORY, fetchForkSyncStatus } from "../forkSync";
import { ensureLocalApi } from "../localApi";
import { toastManager } from "./ui/toast";

const FORK_SYNC_CHECK_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Fork builds only: keeps a warning toast up while the upstream sync is failing
 * or stuck, and closes it once a later run succeeds. A dismissed warning comes
 * back on the next check while the problem remains.
 */
export function watchForkSync(): void {
  const repository = FORK_SYNC_REPOSITORY;
  if (repository === null) return;
  let toastId: string | null = null;

  const check = async () => {
    const status = await fetchForkSyncStatus(repository);
    // Keep the last known state through network errors and rate limits.
    if (status === null) return;
    if (status.kind === "ok") {
      if (toastId !== null) toastManager.close(toastId);
      toastId = null;
      return;
    }
    const toast = {
      type: "warning" as const,
      title: status.kind === "failed" ? "Fork sync failed" : "Fork sync stopped",
      description:
        status.kind === "failed"
          ? "Upstream changes need a manual rebase before this fork gets new updates."
          : "The fork has not synced with upstream recently, so updates may be stuck.",
      timeout: 0,
      actionProps: {
        children: "Open",
        onClick: () => void ensureLocalApi().shell.openExternal(status.url),
      },
      actionVariant: "outline" as const,
    };
    if (toastId === null) {
      toastId = toastManager.add({
        ...toast,
        onClose: () => {
          toastId = null;
        },
      });
    } else {
      toastManager.update(toastId, toast);
    }
  };

  void check();
  window.setInterval(() => void check(), FORK_SYNC_CHECK_INTERVAL_MS);
}
