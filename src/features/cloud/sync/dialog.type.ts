/** 同步过程中需要用户确认或查看的弹窗状态。 */

export type ConflictItem = {
  month: string
  localRecordCount: number
  kind: 'month' | 'type-templates'
}

export type ConflictDialogState = {
  items: ConflictItem[]
  resolve: (confirmed: boolean) => void
}

export type ConflictDialogProps = {
  state: ConflictDialogState | undefined
}

export type BrokenMonthsDialogProps = {
  months: string[] | undefined
  onClose: () => void
}
