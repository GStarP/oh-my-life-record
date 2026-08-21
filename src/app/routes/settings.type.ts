import type { ReactNode } from 'react'

export type SectionProps = {
  title: string
  children: ReactNode
}

export type SettingsRowProps = {
  label: string
  children: ReactNode
}

export type SettingsActionRowProps = {
  label: string
  disabled?: boolean
  onClick: () => void
}
