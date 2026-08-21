import type { ElementType } from 'react'

export type TabLinkProps = {
  to: '/records' | '/settings'
  icon: ElementType
  label: string
  active: boolean
}
