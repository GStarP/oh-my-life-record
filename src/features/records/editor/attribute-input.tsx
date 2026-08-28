/** 根据模板录入方式渲染单个记录属性值；自由属性按基础值类型渲染。 */
import {
  Combobox,
  createListCollection,
  Flex,
  Input,
  Switch,
  Text,
} from '@chakra-ui/react'
import type { AttributeValueInputProps } from './attribute-input.type'

export function AttributeValueInput({ row, onChange }: AttributeValueInputProps) {
  if (row.templateKind === 'option') {
    const options = row.options ?? []
    const collection = createListCollection({
      items: options.map((option) => ({ label: option, value: option })),
    })
    const value = typeof row.value === 'string' ? row.value : String(row.value)
    return (
      <Combobox.Root
        collection={collection}
        value={value ? [value] : []}
        inputValue={value}
        allowCustomValue
        openOnClick
        onValueChange={(details) => onChange(details.value[0] ?? '')}
        onInputValueChange={(details) => onChange(details.inputValue)}
        flex="1"
        minW="0"
      >
        <Combobox.Control>
          <Combobox.Input />
          <Combobox.IndicatorGroup>
            <Combobox.Trigger />
          </Combobox.IndicatorGroup>
        </Combobox.Control>
        <Combobox.Positioner>
          <Combobox.Content>
            <Combobox.Empty>没有匹配的选项</Combobox.Empty>
            <Combobox.List>
              {options.map((option) => (
                <Combobox.Item
                  key={option}
                  item={{ label: option, value: option }}
                >
                  <Combobox.ItemText>{option}</Combobox.ItemText>
                  <Combobox.ItemIndicator />
                </Combobox.Item>
              ))}
            </Combobox.List>
          </Combobox.Content>
        </Combobox.Positioner>
      </Combobox.Root>
    )
  }

  if (row.valueType === 'text') {
    return (
      <Input
        flex="1"
        minW="0"
        value={String(row.value)}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  }

  if (row.valueType === 'number') {
    return (
      <Input
        flex="1"
        minW="0"
        type="number"
        value={row.value === '' ? '' : String(row.value)}
        onChange={(event) =>
          onChange(event.target.value === '' ? '' : Number(event.target.value))
        }
      />
    )
  }

  return (
    <Flex align="center" gap="xs" flex="1" minW="0">
      <Text textStyle="sm" color="fg.muted" flexShrink="0">
        否
      </Text>
      <Switch.Root
        size="lg"
        flexShrink="0"
        checked={Boolean(row.value)}
        onCheckedChange={(event) => onChange(event.checked)}
      >
        <Switch.HiddenInput aria-label={row.key || '属性值'} />
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
      </Switch.Root>
      <Text textStyle="sm" color="fg.muted" flexShrink="0">
        是
      </Text>
    </Flex>
  )
}
