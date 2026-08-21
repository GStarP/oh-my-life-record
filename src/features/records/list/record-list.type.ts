import type { LifeRecord } from '../type'
import type { ImageManager } from '../images/image-manager.type'

export type RecordDayGroup = {
  key: string
  label: string
  records: LifeRecord[]
}

export type RecordListItem =
  | { kind: 'day'; group: RecordDayGroup }
  | { kind: 'record'; record: LifeRecord }

export type InitialRecordLoad = {
  records: LifeRecord[]
  nextMonth: string | undefined
  earliestMonth: string | undefined
}

export type RecordCardProps = {
  record: LifeRecord
  onOpen: (record: LifeRecord) => void
  imageManager: ImageManager
}

export type RecordAttributeTagsProps = {
  record: LifeRecord
}

export type RecordDayHeaderProps = {
  label: string
}
