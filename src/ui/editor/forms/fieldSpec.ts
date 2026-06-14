import { DatabaseSnapshot } from '@/core/framework/validation/validateDatabase'

export type FieldKind = 'number' | 'text' | 'color' | 'textarea' | 'select-fk' | 'select-enum'

export interface FieldSpecBase {
  /** ключ поля в записи */
  key: string
  /** подпись (uppercase в UI) */
  label: string
  kind: FieldKind
  /** поле только для чтения (например, id) */
  readonly?: boolean
  /** занимает всю ширину грида */
  full?: boolean
}

export interface NumberFieldSpec extends FieldSpecBase {
  kind: 'number'
  step?: number
  min?: number
  max?: number
}

export interface TextFieldSpec extends FieldSpecBase {
  kind: 'text' | 'textarea' | 'color'
  placeholder?: string
}

/** FK-поле: селект из записей другой таблицы, отображаемых через резолвер */
export interface FkFieldSpec extends FieldSpecBase {
  kind: 'select-fk'
  /** таблица, на которую ссылается FK */
  references: keyof DatabaseSnapshot
  /** допускает null (например parentId центрального тела) */
  nullable?: boolean
  /** исключить запись с этим id из вариантов (защита от самоссылки) */
  excludeSelf?: boolean
}

/** enum-поле: фиксированный набор значений (resourceType, direction, colorSpace) */
export interface EnumFieldSpec extends FieldSpecBase {
  kind: 'select-enum'
  options: Array<{ value: string; label: string }>
  nullable?: boolean
}

export type FieldSpec = NumberFieldSpec | TextFieldSpec | FkFieldSpec | EnumFieldSpec

export interface TableSpec {
  /** имя таблицы в snapshot */
  table: keyof DatabaseSnapshot
  /** заголовок таба/списка */
  title: string
  /** поля формы (id обычно readonly первым) */
  fields: FieldSpec[]
  /**
   * как назвать запись в списке слева.
   * Для именованных (actors/categories) — по своему полю.
   * Для безымянных — '#id → actor name' через резолвер actorId.
   */
  listLabel: (row: Record<string, unknown>, ctx: ListLabelContext) => string
  /** значения по умолчанию для новой записи (без id — его проставит nextId) */
  defaults: () => Record<string, unknown>
}

export interface ListLabelContext {
  /** резолв actorId -> имя актора (для безымянных таблиц) */
  actorName: (actorId: number | null) => string
}
