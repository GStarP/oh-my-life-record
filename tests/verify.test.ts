/**
 * 凭证连接验证分类契约测试。
 *
 * 为什么测：凭证错误与网络故障需要不同的修复提示。失败不能保存为可用
 * 凭证，但都允许取消并继续本地使用，不能强制阻断本地入口。
 * 分类边界（HTTP 400/401/403 与 NoSuchBucket = 配置问题；其余 = 不可达）
 * 是容易写错的地方；「桶名写错（NoSuchBucket）」必须被拦下。
 * 使用 listImages 探测可以区分空桶与不存在的桶。
 */
import { describe, expect, it } from 'vitest'
import { verifyCredential } from '../src/features/cloud/credential/verify'
import { CloudRequestError } from '../src/features/cloud/request-error'
import type { CredentialVerifier } from '../src/features/cloud/credential/verify.type'

// 按需抛错的假云端：验证只调 listImages
function fakeCloud(behavior: () => Promise<unknown>): CredentialVerifier {
  return {
    listImages: async () => behavior() as never,
  }
}

describe('verifyCredential：连接验证分类', () => {
  it('listImages 成功（含空桶返回 []）→ ok', async () => {
    // 空桶（云端尚未使用）是正常状态：listImages 返回 [] 即凭证通过
    // 签名与权限验证。
    await expect(verifyCredential(fakeCloud(async () => []))).resolves.toEqual({ ok: true })
  })

  it('NoSuchBucket（桶名/端点写错）→ invalid，提示检查设置', async () => {
    // 最常见的配置错误：桶不存在。R2 返回 404 NoSuchBucket——必须与
    // 「空桶 404 NoSuchKey」区分，否则桶名笔误会被当成空云端保存成功。
    const cloud = fakeCloud(async () => {
      throw new CloudRequestError("桶不存在", 404, "NoSuchBucket")
    })
    await expect(verifyCredential(cloud)).resolves.toMatchObject({ ok: false, kind: "invalid" })
  })

  it('HTTP 400/401/403 → invalid（凭证本身有问题，留在弹窗）', async () => {
    // 签名错误（400）、Access Key 无效（403）都是用户可修复的凭证问题：
    // 验证不能保存失败的凭证，但用户仍可取消并继续本地使用。
    for (const status of [400, 401, 403]) {
      const cloud = fakeCloud(async () => {
        throw new CloudRequestError("测试错误", status)
      })
      await expect(verifyCredential(cloud)).resolves.toMatchObject({ ok: false, kind: "invalid" })
    }
  })

  it('网络失败 / 5xx → no-network，保留明确错误提示', async () => {
    // fetch 网络层失败是 TypeError（不是 CloudRequestError）；5xx 是云端故障。
    // 两者都不是凭证错误，但首次配置时不能把它误判成成功绕过弹窗；
    // 网络层失败使用明确、简短的提示，引导检查网络或云端 CORS 配置。
    await expect(verifyCredential(fakeCloud(async () => { throw new TypeError("fetch failed") })))
      .resolves.toMatchObject({ ok: false, kind: "no-network", message: "连接失败，请检查网络或云端 CORS 配置" })
    await expect(verifyCredential(fakeCloud(async () => { throw new CloudRequestError("5xx", 500) })))
      .resolves.toMatchObject({ ok: false, kind: "no-network", message: expect.any(String) })
  })
})
