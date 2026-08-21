/**
 * 凭证连接验证：保存时与首次引导共用（真实网络请求）。
 *
 * 用 listImages 探测（而非 getManifest）：桶级请求能区分两种 404——
 * NoSuchBucket（桶名/端点写错 → invalid）与「空桶」（返回 [] → ok）；
 * getManifest 的 404 无法区分二者，因此连接验证使用 listImages。
 *
 * 结果分类决定 UI 行为：
 * - ok：凭证通过签名与权限验证（含空桶）；
 * - invalid：NoSuchBucket 或 HTTP 400/401/403——配置本身有问题，用户可修复，留在弹窗；
 * - no-network：网络失败（fetch TypeError）或云端故障（5xx 等），
 *   由全局配置弹窗提示并阻断应用。
 */
import { CloudRequestError } from '../request-error'
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
        return { ok: false, kind: 'invalid' }
      }
    }
    return { ok: false, kind: 'no-network' }
  }
}
