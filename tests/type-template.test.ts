/** 类型模板与记录表单属性模型的核心规则测试。 */
import { describe, expect, it } from 'vitest'
import { attributesToRows, rowsToAttributes } from '../src/features/records/editor/attribute-model'
import { normalizeTemplate, validateTemplate } from '../src/features/type-templates/model'
import { createTypeTemplateWorkflow } from '../src/features/type-templates/workflow'
import { InMemoryStorage } from './helpers/inmemory.storage'

describe('类型模板校验', () => {
  it('同一模板内重复选项会阻止保存，空选项列表仍然合法', () => {
    // 选项本质是字符串建议值，重复会让下拉菜单出现两个相同答案；但
    // 空数组只代表没有建议，Combobox 仍然必须允许用户自由输入。
    expect(
      validateTemplate({
        type: '记账',
        icon: 'library',
        attributes: [{ name: '分类', kind: 'option', options: ['吃喝', '吃喝'] }],
      }),
    ).toMatch(/选项不能重复/)
    expect(
      validateTemplate({
        type: '记账',
        icon: 'library',
        attributes: [{ name: '分类', kind: 'option', options: [] }],
      }),
    ).toBeUndefined()
  })

  it('同一个类型只能有一个模板，属性名也不能重复', () => {
    // 类型是模板身份，重复类型会使表单无法确定使用哪一个；属性名是
    // 记录对象的键，重复则无法无歧义地保存两个值。
    expect(
      validateTemplate(
        { type: '电影', icon: 'library', attributes: [] },
        ['电影'],
      ),
    ).toMatch(/已经有模板/)
    expect(
      validateTemplate({
        type: '电影',
        icon: 'library',
        attributes: [
          { name: '预算', kind: 'number' },
          { name: '预算', kind: 'text' },
        ],
      }),
    ).toMatch(/属性名不能重复/)
  })

  it('归一化会清理类型、属性名和选项两端空格并去掉空选项', () => {
    // 文本输入中常见的首尾空格不应该制造两个看起来相同的类型/选项；
    // 归一化在校验前执行，确保本地与云端保存的是稳定格式。
    expect(
      normalizeTemplate({
        type: '  记账 ',
        icon: 'wallet',
        attributes: [
          { name: ' 分类 ', kind: 'option', options: [' 吃喝 ', '', '购物'] },
        ],
      }),
    ).toEqual({
      type: '记账',
      icon: 'wallet',
      attributes: [{ name: '分类', kind: 'option', options: ['吃喝', '购物'] }],
    })
  })
})

describe('模板表单属性合并与存储收敛', () => {
  it('模板新增属性显示为空，旧属性顺序保留，模板删除的旧属性回退为自由属性', () => {
    // 记录不复制模板配置：打开编辑器时用当前模板实时合并。模板新增的
    // “账户”只在表单出现；旧的“备注”不在模板中时仍保留原位置和原值。
    const rows = attributesToRows(
      { 备注: '现金', 分类: '吃喝' },
      {
        type: '记账',
        icon: 'wallet',
        attributes: [
          { name: '分类', kind: 'option', options: ['吃喝'] },
          { name: '账户', kind: 'text' },
        ],
      },
    )

    expect(rows.map((row) => row.key)).toEqual(['备注', '分类', '账户'])
    expect(rows[0].locked).toBe(false)
    expect(rows[1].locked).toBe(true)
    expect(rows[1].templateKind).toBe('option')
    expect(rows[2].locked).toBe(true)
    expect(rows[2].value).toBe('')
  })

  it('文本/数值空值不存储，但布尔 false 和数值 0 都保留', () => {
    // “没有属性”和“属性值为空”在记录存储中等价；相反 false 与 0 是
    // 用户明确填写的有效值，不能被 Number(value) || 0 之类的逻辑吞掉。
    const rows = attributesToRows({
      空文本: '',
      空数值: '' as never,
      布尔值: false,
      零数值: 0,
    })

    expect(rowsToAttributes(rows)).toEqual({
      布尔值: false,
      零数值: 0,
    })
  })
})

describe('类型模板操作层', () => {
  it('保存层再次保证类型唯一且禁止编辑时改类型', async () => {
    // UI 的只读输入不是完整保护：未来可能还有导入、脚本或其他调用方。
    // 非 React workflow 必须在真正写入 IndexedDB 前再次守住类型身份规则。
    const workflow = createTypeTemplateWorkflow({ storage: new InMemoryStorage() })
    await workflow.save({ type: '记账', icon: 'library', attributes: [] })

    await expect(
      workflow.save({ type: '记账', icon: 'library', attributes: [] }),
    ).rejects.toThrow(/已经有模板/)
    await expect(
      workflow.save({ type: '电影', icon: 'library', attributes: [] }, '记账'),
    ).rejects.toThrow(/不能修改/)
  })
})
