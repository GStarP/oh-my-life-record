/** 单个记录属性值输入控件的 props。 */
import type { AttributeRow } from './attribute-model.type'

export type AttributeValueInputProps = {
  row: AttributeRow
  onChange: (value: string | number | boolean) => void
}
