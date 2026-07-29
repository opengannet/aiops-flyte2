import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActionPhase } from "@/gen/flyteidl2/common/phase_pb";
import { LogLineOriginator } from "@/gen/flyteidl2/logs/dataplane/payload_pb";
import { RunLogType } from "./types";
import { RunDetailsLogsTab } from "./RunDetailsLogsTab";

const mocks = vi.hoisted(() => ({
  selectedActionId: "a0",
  selectedAttempt: {
    attempt: 2,
    phase: 5,
    logsAvailable: false,
    logInfo: [],
    clusterEvents: [],
  },
  useHawkRunLogs: vi.fn(),
  useWatchClusterEvents: vi.fn(),
  useWatchLogs: vi.fn(),
  logViewerProps: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({
    project: "aione",
    domain: "development",
    runId: "run-a",
  }),
}));

vi.mock("@/hooks/useOrg", () => ({
  useOrg: () => "aione",
}));

vi.mock("@/components/pages/RunDetails/hooks/useSelectedItem", () => ({
  useSelectedActionId: () => mocks.selectedActionId,
}));

vi.mock("@/components/pages/RunDetails/state/AttemptStore", () => ({
  useSelectedAttemptStore: (selector: (state: unknown) => unknown) =>
    selector({ selectedAttempt: mocks.selectedAttempt }),
}));

vi.mock("@/hooks/useWatchActionDetails", () => ({
  useWatchActionDetails: () => ({ data: { id: "action-details" } }),
}));

vi.mock("@/hooks/useHawkRunLogs", () => ({
  useHawkRunLogs: mocks.useHawkRunLogs,
}));

vi.mock("@/hooks/useWatchLogs", () => ({
  useWatchLogs: mocks.useWatchLogs,
}));

vi.mock("@/hooks/useWatchClusterEvents", () => ({
  useWatchClusterEvents: mocks.useWatchClusterEvents,
}));

vi.mock("@/components/pages/RunDetails/LogsK8sSwitch", () => ({
  RunK8sSwitch: ({
    currentValue,
    onChange,
  }: {
    currentValue: RunLogType;
    onChange: (type: RunLogType) => void;
  }) => (
    <div>
      <button
        aria-pressed={currentValue === RunLogType.RUN}
        onClick={() => onChange(RunLogType.RUN)}
      >
        Run Logs
      </button>
      <button
        aria-pressed={currentValue === RunLogType.K8S}
        onClick={() => onChange(RunLogType.K8S)}
      >
        Kubernetes Events
      </button>
    </div>
  ),
}));

vi.mock("@/components/pages/RunDetails/LogsExtLinksBar", () => ({
  default: () => null,
}));

vi.mock("@/components/LogViewer/LogViewer", () => ({
  LOG_VIEWER_MIN_WIDTH_PX: 700,
  LogViewer: (props: {
    logs?: Array<{ message?: string }>;
    logType?: RunLogType;
  }) => {
    mocks.logViewerProps(props);
    return (
      <div data-testid="logviewer">
        {props.logs?.map((line, index) => (
          <span key={`${index}-${line.message}`}>{line.message}</span>
        ))}
      </div>
    );
  },
}));

describe("RunDetailsLogsTab", () => {
  beforeEach(() => {
    mocks.selectedActionId = "a0";
    mocks.selectedAttempt = {
      attempt: 2,
      phase: ActionPhase.SUCCEEDED,
      logsAvailable: false,
      logInfo: [],
      clusterEvents: [],
    };
    mocks.useHawkRunLogs.mockReturnValue({
      data: {
        lines: [
          {
            timestamp: { seconds: 100, nanos: 0 },
            message: "hawk historical log",
            originator: LogLineOriginator.USER,
          },
        ],
      },
      isFetched: true,
      error: null,
    });
    mocks.useWatchLogs.mockReturnValue({
      data: { lines: [{ message: "legacy pod log" }] },
      isFetched: true,
      error: null,
    });
    mocks.useWatchClusterEvents.mockReturnValue({
      data: { lines: [{ message: "k8s event" }] },
      isFetched: true,
      error: null,
    });
    mocks.logViewerProps.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("loads Hawk run logs for a terminal attempt even when pod logs are unavailable", () => {
    render(<RunDetailsLogsTab />);

    expect(screen.getByText("hawk historical log")).toBeVisible();
    expect(screen.queryByText("legacy pod log")).not.toBeInTheDocument();
    expect(mocks.useHawkRunLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        org: "aione",
        project: "aione",
        domain: "development",
        runId: "run-a",
        actionId: "a0",
        attempt: 2,
        enabled: true,
        isTerminal: true,
      }),
    );
    expect(mocks.logViewerProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        done: true,
        waiting: false,
        logType: RunLogType.RUN,
      }),
    );
  });

  it("keeps Kubernetes Events wired to the cluster events stream", () => {
    render(<RunDetailsLogsTab />);

    fireEvent.click(screen.getByRole("button", { name: "Kubernetes Events" }));

    expect(screen.getByText("k8s event")).toBeVisible();
    expect(mocks.logViewerProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        logType: RunLogType.K8S,
        shouldSkipIcon: true,
      }),
    );
  });
});
