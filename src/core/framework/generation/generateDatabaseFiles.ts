import { DatabaseSnapshot, validateDatabase, ScenarioRefs } from '@/core/framework/validation/validateDatabase'

/**
 * Генератор плоских файлов данных ("компилятор таблиц").
 *
 * Превращает снимок database обратно в TS-исходники — по файлу на таблицу
 * Значения запекаются как есть (числа уже вычислены в рантайме database)
 *
 * КОНТРАКТ ЭКСПОРТОВ: имена экспортируемых констант (Categories, Actors,
 * PhysicalObjects, ...) обязаны совпадать с тем, что импортирует
 * config/database.ts — иначе рантайм сломается. Эти имена зафиксированы ниже.
 */

/** Конфиг одной таблицы: имя экспорта, интерфейс, имя файла */
interface TableSpec<T> {
  /** имя экспортируемой константы (контракт с config/database.ts) */
  exportName: string
  /** имя TS-интерфейса для аннотации типа */
  interfaceName: string
  /** имя генерируемого файла (без расширения) */
  fileName: string
  /** строки данных */
  rows: T[]
}

export interface GeneratorInput extends DatabaseSnapshot {}

export interface GeneratedFile {
  path: string
  content: string
}

/**
 * Сериализует одно значение в TS-литерал.
 * Все значения в database — чистый JSON (числа, строки, null, массивы,
 * вложенные объекты), поэтому JSON.stringify корректен. Доводим до
 * стиля проекта (без кавычек у ключей-идентификаторов) ниже.
 */
function serializeValue(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'null'

    return serializeNumber(value)
  }
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return String(value)

  if (Array.isArray(value)) {
    return '[' + value.map(serializeValue).join(', ') + ']'
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      // отбрасываем undefined-поля (опциональные параметры ресурсов)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${serializeKey(k)}: ${serializeValue(v)}`)

    return '{ ' + entries.join(', ') + ' }'
  }

  // функции/symbol/undefined в данных быть не должно — но не молчим
  throw new Error(`Cannot serialize value of type ${typeof value}: ${String(value)}`)
}

/** Ключ без кавычек, если это валидный идентификатор; иначе в кавычках */
function serializeKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key)
}

function serializeRow(row: unknown): string {
  return '  ' + serializeValue(row)
}

function renderFile<T>(spec: TableSpec<T>): string {
  const header =
    `// ⚠️ AUTO-GENERATED FILE — DO NOT EDIT BY HAND.\n` +
    `// Generated from the database editor. Edit data via the editor UI, then regenerate.\n\n` +
    `import { ${spec.interfaceName} } from '@/core/models/types'\n\n`

  if (spec.rows.length === 0) {
    return header + `export const ${spec.exportName}: ${spec.interfaceName}[] = []\n`
  }

  const body = spec.rows.map(serializeRow).join(',\n')

  return header + `export const ${spec.exportName}: ${spec.interfaceName}[] = [\n${body}\n]\n`
}

/**
 * Главная функция. Прогоняет валидатор ПЕРЕД генерацией —
 * невалидные данные физически не могут быть записаны.
 *
 * @throws Error если данные не проходят валидацию (с перечислением ошибок)
 */
export function generateDatabaseFiles(
  input: GeneratorInput,
  scenarios: ScenarioRefs[] = [],
  options: { baseDir?: string; skipValidation?: boolean } = {}
): GeneratedFile[] {
  const baseDir = options.baseDir ?? 'storage/database'

  if (!options.skipValidation) {
    const validation = validateDatabase(input, scenarios)
    if (!validation.ok) {
      const list = validation.errors.map((e) => '  - ' + e.message).join('\n')
      throw new Error(`Refusing to generate: database has ${validation.errors.length} integrity error(s):\n${list}`)
    }
  }

  // Контракт экспортов фиксирован здесь. Менять имена нельзя без правки config/database.ts.
  const specs: TableSpec<unknown>[] = [
    { exportName: 'Categories', interfaceName: 'ICategory', fileName: 'categories', rows: input.categories },
    { exportName: 'Actors', interfaceName: 'IActor', fileName: 'actors', rows: input.actors },
    { exportName: 'Orbits', interfaceName: 'IOrbit', fileName: 'orbits', rows: input.orbits },
    {
      exportName: 'RotationObjects',
      interfaceName: 'IRotationObject',
      fileName: 'rotationObjects',
      rows: input.rotationObjects
    },
    {
      exportName: 'PhysicalObjects',
      interfaceName: 'IPhysicalObject',
      fileName: 'physicalObjects',
      rows: input.physicalObjects
    },
    {
      exportName: 'RenderingObjects',
      interfaceName: 'IRenderingObject',
      fileName: 'renderingObjects',
      rows: input.renderingObjects
    },
    { exportName: 'Placements', interfaceName: 'IPlacement', fileName: 'placements', rows: input.placements },
    { exportName: 'Resources', interfaceName: 'IResource', fileName: 'resources', rows: input.resources },
    {
      exportName: 'ActorResource',
      interfaceName: 'IActorResource',
      fileName: 'actorResource',
      rows: input.actorResource
    }
  ]

  const files: GeneratedFile[] = specs.map((spec) => ({
    path: `${baseDir}/${spec.fileName}.ts`,
    content: renderFile(spec)
  }))

  // index.ts реэкспортит все восемь массивов — это то, что импортирует config/database.ts
  files.push({
    path: `${baseDir}/index.ts`,
    content: renderIndex(specs)
  })

  return files
}

function renderIndex(specs: TableSpec<unknown>[]): string {
  const header = `// ⚠️ AUTO-GENERATED FILE — DO NOT EDIT BY HAND.\n\n`

  const reexports = specs.map((spec) => `export { ${spec.exportName} } from './${spec.fileName}'`).join('\n')

  return header + reexports + '\n'
}

function serializeNumber(value: number): string {
  const plain = String(value)

  // целые за пределами безопасного диапазона — обязательно в экспоненту
  if (Number.isInteger(value) && Math.abs(value) >= Number.MAX_SAFE_INTEGER) {
    return normalizeExponent(value.toExponential())
  }

  // в остальных случаях берём более короткую из двух записей
  const exp = normalizeExponent(value.toExponential())
  return exp.length < plain.length ? exp : plain
}

function normalizeExponent(exp: string): string {
  return exp.replace('e+', 'e')
}
