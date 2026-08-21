/**
 * R2 云端文件格式的纯编解码契约测试（不联网）。
 *
 * 为什么测这些：云端 JSON 的序列化/反序列化（Date ↔ ISO 字符串，
 * ADR-0006）与损坏防护直接决定下载数据能否安全写入本地：
 * - 签名 URL 不在本文件断言；tests/r2.smoke.test.ts 只在真实 R2 上验证
 *   应用生成的 URL 可访问，避免复刻 aws4fetch 或 R2 平台自身的实现测试；
 * - 配置校验由设置页保存时的真实连接验证覆盖。
 */
import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION } from '../src/features/cloud/r2/schema'
import type { LifeRecord } from '../src/features/records/type'
import type { Manifest, PartitionFile } from '../src/features/cloud/sync/engine.type'
import type { TypeTemplatesFile } from '../src/features/type-templates/type'
import {
  decodeManifest,
  decodePartitionFile,
  decodeTypeTemplatesFile,
  encodeManifest,
  encodePartitionFile,
  encodeTypeTemplatesFile,
} from '../src/features/cloud/r2/codec'

function rec(id: string, time: string): LifeRecord {
  return { id, time: new Date(time), type: '测试', description: '', images: [], attributes: {} }
}

describe('分片 JSON 编解码（云端格式，ADR-0006）', () => {
  it('encode 把 Date 序列化为 ISO 字符串；decode 往返还原同一绝对瞬间', () => {
    // 云端 JSON 只能存字符串：JSON.stringify(Date) → UTC ISO（带 Z）。
    // 下载侧 string→Date 转换由 CloudAdapter 负责（storage.type.ts 契约），
    // 往返必须还原出完全相同的绝对瞬间（getTime 相等），月份归属由
    // 读取端 date-fns-tz 重新换算，不随设备时区变化（ADR-0003/0006）。
    const file: PartitionFile = {
      month: '2026-08',
      revision: 5,
      // UTC+8 归属 9 月 1 日的跨月瞬间：最能暴露「按 UTC 月归属」类错误
      records: [rec('a', '2026-08-31T17:30:00.000Z')],
    }

    const text = encodePartitionFile(file)
    expect(JSON.parse(text).records[0].time).toBe('2026-08-31T17:30:00.000Z')

    const back = decodePartitionFile(text)
    expect(back.month).toBe('2026-08')
    expect(back.revision).toBe(5)
    expect(back.records[0].time).toBeInstanceOf(Date)
    expect(back.records[0].time.getTime()).toBe(file.records[0].time.getTime())
  })

  it('损坏 JSON / 结构不符 → 拒绝写入本地', () => {
    // 引擎把「文件不可用」视为损坏月：不覆盖本地、不中止同步——brokenMonths
    // 由适配器在边界实现（catch 后
    // 返回 undefined）；解码器本身一律抛错（与 decodeManifest 同模式），
    // 这里只锁定“拒绝脏数据”的外部契约，不绑定具体错误文案。
    expect(() => decodePartitionFile('not-json')).toThrow()
    // 合法 JSON 但结构不符：records 不是数组
    expect(() =>
      decodePartitionFile('{"month":"2026-08","revision":1,"records":{"a":1}}'),
    ).toThrow()
    // month 非字符串
    expect(() =>
      decodePartitionFile('{"month":7,"revision":1,"records":[]}'),
    ).toThrow()
    // revision 非数字
    expect(() =>
      decodePartitionFile('{"month":"2026-08","revision":"1","records":[]}'),
    ).toThrow()
  })

  it('记录字段不完整或 time 非法 → 拒绝写入本地', () => {
    // 记录形状校验：下载的记录要直接写入 IndexedDB，字段缺失/类型错误
    // 会污染本地数据；time 不可解析则月份归属无从谈起，一律视为损坏。
    const base = encodePartitionFile({
      month: '2026-08',
      revision: 1,
      records: [rec('a', '2026-08-01T00:00:00.000Z')],
    })
    expect(() => decodePartitionFile(base.replace('"id":"a"', '"id":7'))).toThrow()
    expect(() =>
      decodePartitionFile(base.replace('"time":"2026-08-01T00:00:00.000Z"', '"time":"not-a-date"')),
    ).toThrow()
    expect(() => decodePartitionFile(base.replace('"images":[]', '"images":"x"'))).toThrow()
  })
})

describe('manifest 编解码', () => {
  it('合法 manifest 往返', () => {
    // 序列化与反序列化的基准正确性：编码后解码必须还原出完全相同的
    // manifest（含多月的 partitions 表），这是启动检查与同步判定的输入。
    const m: Manifest = { schemaVersion: SCHEMA_VERSION, typeTemplatesRevision: 0, partitions: { '2026-06': 3, '2026-08': 10 } }
    expect(decodeManifest(encodeManifest(m))).toEqual(m)
  })

  it('损坏 manifest → 拒绝参与同步决策', () => {
    // 与分片不同：manifest 驱动全部同步决策（哪些月可下载/可上传），
    // 解析失败必须显式失败（UI 报错），而不能当作「空云端」——那会把
    // 本地脏月误判为「云端无此月」而覆盖云端。
    // 只锁定脏 manifest 不能被当成空云端，不绑定错误文案。
    expect(() => decodeManifest('not-json')).toThrow()
    expect(() => decodeManifest('{"schemaVersion":2,"partitions":{}}')).toThrow()
    expect(() => decodeManifest('{"schemaVersion":1,"partitions":{"2026-08":"x"}}')).toThrow()
  })
})

describe('类型模板文件编解码', () => {
  it('模板文件往返保留四种录入方式和选项', () => {
    // type-templates.json 是独立的全局同步文件；四种录入方式和选项数组
    // 必须在云端往返中保持，否则重新打开记录表单会丢失控件规则。
    const file: TypeTemplatesFile = {
      revision: 3,
      templates: [
        {
          type: '记账',
          icon: 'wallet',
          attributes: [
            { name: '说明', kind: 'text' },
            { name: '费用', kind: 'number' },
            { name: '已结算', kind: 'boolean' },
            { name: '分类', kind: 'option', options: ['吃喝', '购物'] },
          ],
        },
      ],
    }

    expect(decodeTypeTemplatesFile(encodeTypeTemplatesFile(file))).toEqual(file)
  })

  it('模板文件结构损坏或属性名/选项重复会被拒绝', () => {
    // 云端文件会直接进入本地 IndexedDB；发现脏数据时必须按损坏文件处理，
    // 不能把重复键悄悄写入本地导致表单规则不确定。
    expect(() => decodeTypeTemplatesFile('not-json')).toThrow()
    expect(() =>
      decodeTypeTemplatesFile(
        JSON.stringify({
          revision: 1,
          templates: [
            {
              type: '记账',
              icon: 'wallet',
              attributes: [
                { name: '分类', kind: 'option', options: ['吃喝', '吃喝'] },
              ],
            },
          ],
        }),
      ),
    ).toThrow()
  })
})
