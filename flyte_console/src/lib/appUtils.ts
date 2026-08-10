/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { App, Condition } from "@/gen/flyteidl2/app/app_definition_pb";
import { Status_DeploymentStatus } from "@/gen/flyteidl2/app/app_definition_pb";
import { getRelativeDate } from "@/lib/dateUtils";

export const getStatus = (appConditions: Condition[] | undefined) => {
  const lastCondition = appConditions?.length
    ? appConditions[appConditions.length - 1]
    : undefined;
  return lastCondition?.deploymentStatus || Status_DeploymentStatus.UNSPECIFIED;
};

export const getLastDeployed = (appConditions: Condition[] | undefined) => {
  return appConditions?.find(
    (condition) =>
      condition.deploymentStatus === Status_DeploymentStatus.ACTIVE,
  );
};

export const getLastDeployedData = (app: App | undefined) => {
  const lastDeployment = getLastDeployed(app?.status?.conditions);
  const deployedTimestamp =
    lastDeployment?.lastTransitionTime ?? app?.status?.createdAt;
  let relativeTime = "-";
  if (deployedTimestamp) {
    relativeTime = getRelativeDate(deployedTimestamp, "always");
  }
  return {
    deployedTimestamp,
    relativeTime,
    version: Number(lastDeployment?.revision).toString() || "-",
  };
};
