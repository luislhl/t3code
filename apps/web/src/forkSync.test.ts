import { describe, expect, it } from "vite-plus/test";

import { forkSyncWorkflowUrl, resolveForkSyncStatus } from "./forkSync";

const REPOSITORY = "someone/t3code";
const FINISHED_AT = "2026-09-25T12:00:00.000Z";
const HOUR = 60 * 60 * 1000;
const RUN_URL = "https://github.com/someone/t3code/actions/runs/1";

const statusAfter = (conclusion: string | null, hours: number) =>
  resolveForkSyncStatus({
    repository: REPOSITORY,
    latestRun: { conclusion, html_url: RUN_URL, updated_at: FINISHED_AT },
    now: Date.parse(FINISHED_AT) + hours * HOUR,
  });

describe("resolveForkSyncStatus", () => {
  it("is quiet after a recent successful sync", () => {
    expect(statusAfter("success", 1)).toEqual({ kind: "ok" });
  });

  it.each(["failure", "timed_out", "startup_failure"])(
    "links to the run that ended with %s",
    (conclusion) => {
      expect(statusAfter(conclusion, 1)).toEqual({
        kind: "failed",
        url: RUN_URL,
        at: FINISHED_AT,
      });
    },
  );

  it("keeps reporting a failure until a later run succeeds", () => {
    expect(statusAfter("failure", 48).kind).toBe("failed");
  });

  it("does not treat a cancelled run as a failure", () => {
    expect(statusAfter("cancelled", 1)).toEqual({ kind: "ok" });
  });

  it("reports a sync that stopped running", () => {
    expect(statusAfter("success", 13)).toEqual({
      kind: "stale",
      url: forkSyncWorkflowUrl(REPOSITORY),
      at: FINISHED_AT,
    });
    expect(
      resolveForkSyncStatus({ repository: REPOSITORY, latestRun: null, now: Date.now() }),
    ).toEqual({ kind: "stale", url: forkSyncWorkflowUrl(REPOSITORY), at: null });
  });
});
