import { File, Paths } from 'expo-file-system';

import { cloudRequest, CloudHttpError, CloudNotConfiguredError, NotSignedInError, withRetry } from '@/cloud/api';
import { authClient } from '@/cloud/auth';
import { CLOUD_CONFIGURED, CLOUD_URL } from '@/cloud/config';
import { IMPORT_CONTENT_TYPE } from '@/features/huaweiimport/importFileCore';

/** One row of `GET /v1/imports`. */
export interface CloudImport {
  id: string;
  status: string;
  filename: string | null;
  contentType: string | null;
  size: number | null;
  /** Epoch ms. */
  createdAt: number;
}

/** What the phone can apply: finished uploads of the browser-made import file (`docs/huawei-web-import.md`), newest first. */
export function webImportsOf(imports: readonly CloudImport[]): CloudImport[] {
  return imports.filter((i) => i.status === 'uploaded' && (i.contentType ?? '').split(';')[0]?.trim().toLowerCase() === IMPORT_CONTENT_TYPE);
}

/** `GET /v1/imports`, narrowed to the import files from the web the phone can apply. Open to every signed-in account. */
export async function listWebImports(): Promise<CloudImport[]> {
  const { imports } = await cloudRequest<{ imports: CloudImport[] }>('GET', '/v1/imports');
  return webImportsOf(imports);
}

/**
 * `GET /v1/imports/:id/file` with the session cookie, saved into the cache. Returns the `file://` uri. Transient failures are retried
 * like every other cloud call; a 404 (applied from another phone, deleted on the web) is a `CloudHttpError`.
 */
export async function downloadWebImport(item: CloudImport): Promise<string> {
  if (!CLOUD_CONFIGURED) throw new CloudNotConfiguredError();
  const cookie = await authClient.getCookie();
  if (!cookie) throw new NotSignedInError();
  const target = new File(Paths.cache, `web-import-${item.id}.ndjson.gz`);
  await withRetry(async () => {
    try {
      await File.downloadFileAsync(`${CLOUD_URL}/v1/imports/${encodeURIComponent(item.id)}/file`, target, {
        headers: { Cookie: cookie },
        idempotent: true,
      });
    } catch (e) {
      // The native error carries the status in its message.
      const status = /\b(401|403|404|429|5\d\d)\b/.exec(e instanceof Error ? e.message : '')?.[1];
      if (status) throw new CloudHttpError(Number(status), null, null);
      throw e;
    }
  });
  return target.uri;
}

/** `DELETE /v1/imports/:id`: removes the stored file and its row once the phone has applied it. */
export async function deleteWebImport(id: string): Promise<void> {
  await cloudRequest('DELETE', `/v1/imports/${encodeURIComponent(id)}`);
}
