/**
 * 漏 Copyright Union Systems Inc 2026. All rights reserved.
 */

import { getConsoleApiPath } from "@/components/pages/DevelopmentInstances/utils";
import type { HawkRunLogsResult } from "@/server/hawk/run-logs";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

type UseHawkRunLogsOptions = {
  org: string;
  project: string;
  domain: string;
  runId: string;
  actionId?: string | null;
  attempt?: number | null;
  enabled?: boolean;
  isTerminal?: boolean;
};

type HawkRunLogsResponse = {
  status?: number;
  message?: string;
  error?: string;
  data?: HawkRunLogsResult;
};

export function useHawkRunLogs({
  org,
  project,
  domain,
  runId,
  actionId,
  attempt,
  enabled = false,
  isTerminal = false,
}: UseHawkRunLogsOptions) {
  const queryString = useMemo(() => {
    if (!actionId) {
      return null;
    }
    const search = new URLSearchParams();
    search.set("org", org);
    search.set("project", project);
    search.set("domain", domain);
    search.set("runId", runId);
    search.set("actionId", actionId);
    if (attempt !== null && attempt !== undefined) {
      search.set("attempt", String(attempt));
    }
    return search.toString();
  }, [actionId, attempt, domain, org, project, runId]);

  return useQuery<HawkRunLogsResult>({
    queryKey: ["hawkRunLogs", queryString],
    queryFn: async () => {
      const response = await fetch(
        getConsoleApiPath(`/api/hawk/run-logs?${queryString}`),
        {
          cache: "no-store",
        },
      );
      const body = (await response.json()) as HawkRunLogsResponse;
      if (!response.ok || !body.data) {
        throw new Error(
          body.message || body.error || "Failed to load Hawk logs.",
        );
      }
      return body.data;
    },
    enabled: !!queryString && enabled,
    refetchInterval: enabled && !isTerminal ? 5000 : false,
    refetchOnWindowFocus: false,
    gcTime: 0,
    staleTime: 0,
  });
}
