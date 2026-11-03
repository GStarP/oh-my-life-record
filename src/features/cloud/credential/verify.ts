import { CloudRequestError, cloudErrorMessage } from '../request-error'
import type { CredentialVerifier, VerifyResult } from './verify.type'

export async function verifyCredential(
  cloud: CredentialVerifier,
): Promise<VerifyResult> {
  try {
    await cloud.listImages()
    return { ok: true }
  } catch (err) {
    if (err instanceof CloudRequestError) {
      const invalidStatus = [400, 401, 403]
      if (err.code === 'NoSuchBucket' || invalidStatus.includes(err.status)) {
        return { ok: false, kind: 'invalid', message: cloudErrorMessage(err) }
      }
    }
    return { ok: false, kind: 'no-network', message: cloudErrorMessage(err) }
  }
}
