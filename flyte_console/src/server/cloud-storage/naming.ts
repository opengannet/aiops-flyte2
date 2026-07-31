/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

const CANONICAL_STORAGE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
// The storage ID is also stored as a Kubernetes label value.
const MAX_STORAGE_ID_LENGTH = 63;

export function buildCloudStoragePVCName(storageId: string) {
  const id = storageId.trim();
  if (
    id.length > MAX_STORAGE_ID_LENGTH ||
    !CANONICAL_STORAGE_ID_PATTERN.test(id)
  ) {
    throw new Error("datastore id must be a canonical DNS name");
  }
  return `cs-${id}`;
}
