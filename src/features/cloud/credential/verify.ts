/**
 * 凭证连接验证。用桶级 listImages 区分空桶与 NoSuchBucket；
 * getManifest 的对象级 404 无法区分二者，不能用于验证桶是否存在。
 */
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
