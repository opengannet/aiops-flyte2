/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { NextRequest } from "next/server";
import { loadCloudStorageLiveMounts } from "@/server/cloud-storage/live-mounts";
import { errorEnvelope, okEnvelope, statusError } from "@/server/http/response";
import { getKubernetesClientConfig } from "@/server/kubernetes/client";

export const runtime = "nodejs";

const DEFAULT_NAMESPACE = "flyte";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { storageIds?: unknown };
    if (
      !Array.isArray(body.storageIds) ||
      body.storageIds.some((value) => typeof value !== "string")
    ) {
      throw statusError("storageIds must be an array of strings", 400);
    }
    const storageIds = Array.from(
      new Set(body.storageIds.map((value) => value.trim()).filter(Boolean)),
    );
    const kube = await getKubernetesClientConfig(DEFAULT_NAMESPACE);
    const mounts = await loadCloudStorageLiveMounts({
      ...kube,
      storageIds,
    });
    return okEnvelope({ mounts });
  } catch (error) {
    console.error("Error loading cloud storage live mounts", error);
    return errorEnvelope(error);
  }
}
