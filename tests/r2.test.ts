import { expect, it } from 'vitest'
import { R2CloudAdapter } from '../src/features/cloud/r2/r2'

const config = { endpoint: 'https://example.r2.cloudflarestorage.com', bucket: 'test', accessKeyId: 'test', accessKeySecret: 'test' }
it('拒绝重定向和条件写入失败，不把未提交的数据库报告为成功', async () => {
  // 原生 HTTP 不自动重定向；301 或 412 都不是快照提交成功。
  // 条件提交的结果不明确时也不自动重发，防止把已提交但丢失的响应变成覆盖操作。
  for (const status of [301, 412]) {
    let calls = 0
    const adapter = new R2CloudAdapter(config, async () => { calls++; return { status, headers: {}, body: '' } })
    await expect(adapter.uploadSnapshot({ path: 'snapshot', bytes: 1, sha256: 'a'.repeat(64) }, 1, undefined, 'operation')).rejects.toThrow(String(status))
    expect(calls).toBe(1)
  }
})
it('拒绝没有前进的云端分页及损坏数据库元信息', async () => {
  // 不能人工停止的同步必须拒绝重复分页，避免无限循环；不完整的元信息也不能进入版本判断。
  // 用相同 continuation token 连续返回两页，预期立即失败；缺失 SHA 的 HEAD 同样失败；图片路径也不能归一化到前缀之外。
  let calls = 0
  const adapter = new R2CloudAdapter(config, async () => { calls++; return { status: 200, headers: {}, body: '<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>same</NextContinuationToken></ListBucketResult>' } })
  await expect(adapter.listImages()).rejects.toThrow('分页')
  expect(calls).toBe(2)
  await expect(adapter.getSnapshot()).rejects.toThrow('元信息')
  const invalidPath = new R2CloudAdapter(config, async () => ({ status: 200, headers: {}, body: '<ListBucketResult><Contents><Key>data%2Fimages%2F..</Key><Size>1</Size></Contents></ListBucketResult>' }))
  await expect(invalidPath.listImages()).rejects.toThrow('路径')
})
it('超时直接结束请求，其他短暂故障仍可重试一次', async () => {
  // 原生网络与 JS 等待保护都可能报告超时，任何一种都不能再次等待一个完整时限。
  // 非超时的短暂故障仍保留一次重试，避免收紧超时后把正常的瞬时恢复能力一并移除。
  for (const message of ['timeout', '云端请求超时']) {
    let calls = 0
    const adapter = new R2CloudAdapter(config, async () => { calls++; throw new Error(message) })
    await expect(adapter.getSnapshot()).rejects.toThrow(message)
    expect(calls).toBe(1)
  }
  let calls = 0
  const adapter = new R2CloudAdapter(config, async () => {
    if (++calls === 1) throw new Error('temporary failure')
    return { status: 200, headers: {}, body: '<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>' }
  })
  await expect(adapter.listImages()).resolves.toEqual([])
  expect(calls).toBe(2)
})
