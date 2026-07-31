/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

export function buildCloudStorageDetailHref(
  domain: string | undefined,
  project: string | undefined,
  storageId: string,
) {
  return `/domain/${domain}/project/${project}/cloud-storages/${encodeURIComponent(storageId)}`;
}

export function formatBytes(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "未知";
  }
  if (value === 0) {
    return "0 B";
  }
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let unitIndex = 0;
  let amount = value;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  return unitIndex === 0
    ? `${amount} ${units[unitIndex]}`
    : `${amount.toFixed(1)} ${units[unitIndex]}`;
}

export function formatStatsSource(
  source: "kubelet" | "hawk_history" | "unavailable",
) {
  if (source === "kubelet") {
    return "实时";
  }
  if (source === "hawk_history") {
    return "Hawk 历史";
  }
  return "未知";
}

export function formatNullablePercent(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value.toFixed(2)}%`
    : "未知";
}
