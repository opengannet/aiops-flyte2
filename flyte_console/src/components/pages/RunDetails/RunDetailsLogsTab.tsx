/**
 * 漏 Copyright Union Systems Inc 2026. All rights reserved.
 */

import {
  LOG_VIEWER_MIN_WIDTH_PX,
  LogViewer,
} from "@/components/LogViewer/LogViewer";
import { useSelectedActionId } from "@/components/pages/RunDetails/hooks/useSelectedItem";
import LogsExtLinksBar from "@/components/pages/RunDetails/LogsExtLinksBar";
import { RunK8sSwitch } from "@/components/pages/RunDetails/LogsK8sSwitch";
import {
  RunDetailsPageParams,
  RunLogType,
} from "@/components/pages/RunDetails/types";
import { useHawkRunLogs } from "@/hooks/useHawkRunLogs";
import { useOrg } from "@/hooks/useOrg";
import { useWatchActionDetails } from "@/hooks/useWatchActionDetails";
import { useWatchClusterEvents } from "@/hooks/useWatchClusterEvents";
import { isAttemptTerminal } from "@/lib/attemptUtils";
import { useParams } from "next/navigation";
import React, { useMemo, useState } from "react";
import { useSelectedAttemptStore } from "./state/AttemptStore";

export const RunDetailsLogsTab: React.FC<unknown> = () => {
  const org = useOrg();
  const params = useParams<RunDetailsPageParams>();
  const selectedActionId = useSelectedActionId();
  const selectedActionDetails = useWatchActionDetails(selectedActionId);
  const attempt = useSelectedAttemptStore((s) => s.selectedAttempt);

  const [logsType, setLogsType] = useState<RunLogType>(RunLogType.RUN);

  const isTerminal = isAttemptTerminal(attempt);
  const attemptNumber = attempt?.attempt ? attempt.attempt : 0;

  const runLogs = useHawkRunLogs({
    org,
    project: params.project,
    domain: params.domain,
    runId: params.runId,
    actionId: selectedActionId,
    attempt: attempt?.attempt,
    enabled:
      logsType === RunLogType.RUN &&
      !!org &&
      !!params.project &&
      !!params.domain &&
      !!params.runId &&
      !!selectedActionId,
    isTerminal,
  });

  const clusterEvents = useWatchClusterEvents({
    actionDetails: selectedActionDetails.data,
    attempt: attemptNumber,
    enabled: !!selectedActionDetails.data,
  });

  const source = logsType === RunLogType.K8S ? clusterEvents : runLogs;

  const isWaiting = useMemo(() => {
    if (logsType === RunLogType.K8S) {
      return !isTerminal && !attempt?.clusterEvents?.length;
    }
    return !source.isFetched && !source.error && !source.data?.lines?.length;
  }, [
    attempt?.clusterEvents?.length,
    logsType,
    isTerminal,
    source.data?.lines?.length,
    source.error,
    source.isFetched,
  ]);

  const done =
    logsType === RunLogType.RUN
      ? isTerminal && source.isFetched
      : source.isFetched;

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-5 p-8 pt-2.5"
      style={{ minWidth: LOG_VIEWER_MIN_WIDTH_PX }}
    >
      <div className="flex min-w-0 flex-row gap-x-5">
        <RunK8sSwitch onChange={setLogsType} currentValue={logsType} />
        {attempt?.logInfo && <LogsExtLinksBar logInfo={attempt.logInfo} />}
      </div>
      <div className="flex h-full w-full min-w-0 flex-col gap-3 overflow-hidden rounded-2xl border border-zinc-200 bg-(--system-black) px-5 py-3 dark:border-zinc-800">
        <LogViewer
          enableSourceFilter={logsType !== RunLogType.K8S}
          logs={source.data?.lines}
          done={done}
          error={source.error}
          waiting={isWaiting}
          logType={logsType}
          shouldSkipIcon={logsType === RunLogType.K8S}
        />
      </div>
    </div>
  );
};
