import "server-only";
import { adminBucket } from "./admin";

/*
 * Scanned paper answer sheets in Cloud Storage (server-only; storage.rules deny browsers):
 *   paper-scans/{assignmentId}/{attemptId}.jpg
 * One image per attempt. It's replaced with the attempt and deleted with it or its assignment.
 */

export const MAX_SCAN_BYTES = 2 * 1024 * 1024;

export const scanPath = (assignmentId: string, attemptId: string) => `paper-scans/${assignmentId}/${attemptId}.jpg`;

export async function saveScan(assignmentId: string, attemptId: string, jpeg: Buffer): Promise<string> {
  const path = scanPath(assignmentId, attemptId);
  await adminBucket().file(path).save(jpeg, { contentType: "image/jpeg", resumable: false, metadata: { cacheControl: "private, no-store" } });
  return path;
}

export async function readScan(path: string): Promise<Buffer> {
  const [bytes] = await adminBucket().file(path).download();
  return bytes;
}

/** Remove one attempt's stored scan (if any). */
export async function deleteScan(assignmentId: string, attemptId: string): Promise<void> {
  await adminBucket().file(scanPath(assignmentId, attemptId)).delete({ ignoreNotFound: true });
}

/** Remove every stored scan of an assignment. */
export async function deleteAssignmentScans(assignmentId: string): Promise<void> {
  await adminBucket().deleteFiles({ prefix: `paper-scans/${assignmentId}/` });
}
