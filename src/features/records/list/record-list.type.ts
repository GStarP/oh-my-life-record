import type { LifeRecord } from '../type'
import type { ImageStore } from '../images/files.type'

export type RecordDayGroup = {
  key: string
  label: string
  records: LifeRecord[]
}

export type RecordListItem =
  | { kind: 'day'; group: RecordDayGroup }
  | { kind: 'record'; record: LifeRecord }

export type RecordCardProps = {
  record: LifeRecord
  onOpen: (record: LifeRecord) => void
  imageStore: ImageStore
}

export type RecordAttributeTagsProps = {
  record: LifeRecord
}

export type RecordDayHeaderProps = {
  label: string
}
