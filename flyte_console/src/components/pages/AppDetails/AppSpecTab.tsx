/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { DescriptionListWrapper } from "@/components/DescriptionListWrapper";
import { ExternalLinkUrl } from "@/components/ExternalLinkUrl";
import { TabSection } from "@/components/TabSection";
import { Button } from "@/components/Button";
import { CopyButton } from "@/components/CopyButton";
import {
  App,
  Status_DeploymentStatus,
} from "@/gen/flyteidl2/app/app_definition_pb";
import { getStatus } from "@/lib/appUtils";
import { useMemo, useState } from "react";
import stringify from "safe-stable-stringify";
import {
  extractAppResourceSummary,
  extractModelMetadata,
} from "../ListApps/modelAppUtils";

export const AppSpecTab = ({ app }: { app: App | undefined }) => {
  const [apiKey, setApiKey] = useState("");
  const [apiKeyError, setApiKeyError] = useState("");
  const [isCreatingApiKey, setIsCreatingApiKey] = useState(false);
  const description = app?.spec?.profile?.shortDescription;
  const specJson = stringify(app?.spec);
  const modelMetadata = useMemo(() => extractModelMetadata(app), [app]);
  const isModelApp = app?.spec?.profile?.type === "VLLM";

  const links = app?.spec?.links || [];
  const isActive =
    getStatus(app?.status?.conditions) === Status_DeploymentStatus.ACTIVE;

  const resourceSummary = useMemo(() => extractAppResourceSummary(app), [app]);

  const replicaJson = useMemo(
    () =>
      ({
        Current: app?.status?.currentReplicas,
        Min: app?.spec?.autoscaling?.replicas?.min,
        Max: app?.spec?.autoscaling?.replicas?.max,
      }) as Record<string, unknown>,
    [app?.spec?.autoscaling?.replicas, app?.status?.currentReplicas],
  );

  const requestsJson = useMemo(
    () => resourceSummary.requests as Record<string, unknown>,
    [resourceSummary.requests],
  );

  const limitsJson = useMemo(
    () => resourceSummary.limits as Record<string, unknown>,
    [resourceSummary.limits],
  );

  const modelJson = useMemo(
    () =>
      ({
        Profile: app?.spec?.profile?.type,
        Code: modelMetadata.code,
        Image: modelMetadata.image,
        "Model path": modelMetadata.modelPath,
        "GPU key": modelMetadata.gpuKey,
        PVC: modelMetadata.pvc,
        "Service URL": app?.status?.ingress?.publicUrl,
      }) as Record<string, unknown>,
    [app?.spec?.profile?.type, app?.status?.ingress?.publicUrl, modelMetadata],
  );

  const aboutRawJson = useMemo(() => {
    if (!app?.spec) return {};
    try {
      return JSON.parse(stringify(app.spec)) as Record<string, unknown>;
    } catch {
      return {};
    }
  }, [app?.spec]);

  const createApiKey = async () => {
    const modelCode = modelMetadata.code;
    if (!modelCode) return;
    setApiKey("");
    setApiKeyError("");
    setIsCreatingApiKey(true);
    try {
      const modelPath = modelCode.split("/").map(encodeURIComponent).join("/");
      const response = await fetch(`/api/aione/apikey/${modelPath}`, {
        method: "POST",
      });
      const body = (await response.json()) as {
        data?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(body.message || `HTTP ${response.status}`);
      }
      setApiKey(body.data || "");
    } catch (error) {
      setApiKeyError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsCreatingApiKey(false);
    }
  };

  return (
    <div className="flex w-full min-w-0 flex-col gap-6 [&>*:last-child]:mb-5">
      {description && (
        <div>
          <h3 className="text-sm font-bold">Description</h3>
          <p className="text-sm dark:text-(--system-gray-6)">{description}</p>
        </div>
      )}
      {links.length > 0 && isActive && (
        <div>
          <h3 className="mb-2 text-sm font-bold">Links</h3>
          <div className="flex flex-wrap gap-3">
            {links.map((l) => (
              <ExternalLinkUrl
                iconClassname="dark:text-(--system-gray-6)"
                key={l.path}
                name={l.title}
                url={`${app?.status?.ingress?.publicUrl}${l.path}`}
              ></ExternalLinkUrl>
            ))}
          </div>
        </div>
      )}

      {isModelApp && (
        <TabSection heading="Model" copyButtonContent={stringify(modelJson)}>
          <div className="flex flex-col gap-4 p-4">
            <DescriptionListWrapper rawJson={modelJson} />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                outline
                disabled={!modelMetadata.code || isCreatingApiKey}
                onClick={createApiKey}
                type="button"
              >
                {isCreatingApiKey ? "Creating API key" : "Create API key"}
              </Button>
              {apiKey && (
                <div className="flex min-w-0 items-center gap-2 text-sm">
                  <span className="truncate font-mono">{apiKey}</span>
                  <CopyButton value={apiKey} />
                </div>
              )}
              {apiKeyError && (
                <span className="text-sm text-red-500">{apiKeyError}</span>
              )}
            </div>
          </div>
        </TabSection>
      )}

      <TabSection heading="About" copyButtonContent={specJson}>
        <DescriptionListWrapper rawJson={aboutRawJson} />
      </TabSection>

      <TabSection heading="Replicas">
        <DescriptionListWrapper rawJson={replicaJson} />
      </TabSection>

      <TabSection heading="Requests">
        <DescriptionListWrapper rawJson={requestsJson} />
      </TabSection>

      <TabSection heading="Limits">
        <DescriptionListWrapper rawJson={limitsJson} />
      </TabSection>
    </div>
  );
};
