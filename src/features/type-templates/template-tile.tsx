/** 类型模板的移动端方形入口：上方图标、下方类型名称。 */
import { Button, Icon, Text } from '@chakra-ui/react'
import { LuFileQuestion } from 'react-icons/lu'
import { getTypeTemplateIcon } from './icons/icon-registry'
import type { TypeTemplateTileProps } from './template-tile.type'

export function TypeTemplateTile({
  icon,
  label,
  surface,
  onClick,
}: TypeTemplateTileProps) {
  return (
    <Button
      type="button"
      width="full"
      height="auto"
      minH="0"
      aspectRatio="1"
      padding="xs"
      gap="xs"
      flexDirection="column"
      justifyContent="center"
      variant="subtle"
      bg={surface === 'page' ? 'bg.panel' : 'bg.muted'}
      borderRadius="lg"
      onClick={onClick}
    >
      <Icon as={icon ? getTypeTemplateIcon(icon) : LuFileQuestion} boxSize="6" />
      <Text width="full" textStyle="sm" truncate>
        {label}
      </Text>
    </Button>
  )
}
