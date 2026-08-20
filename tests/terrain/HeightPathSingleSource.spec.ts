import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Чтение height-пути актора живёт в ОДНОМ месте — `heightPathOf`.
 *
 * Докблок этой функции заявлял «единственное место чтения» с самого начала, и
 * к ревью 2026-08-20 (находка №6) заявление было ложным четырежды: свои копии
 * запроса завели PlanetMaterial, CameraCollision и terrainFloorAdjust. Инвариант
 * не косметический: гейт карт высот грузит ресурс по одному правилу, а
 * материал (рельефные дефайны), коллизия (терраформный коллайдер) и геометрия
 * решают по своим — разойдись любая копия в проверке типа или в имени
 * ресурса, и тело поедет с рельефной геометрией без рельефного шейдинга либо
 * со сферической коллизией под настоящими горами. Молча.
 *
 * Файлы читаются с диска, а не импортируются: список потребителей иначе
 * пришлось бы поддерживать руками, и новая копия въехала бы мимо проверки —
 * ровно тот же приём, что у инварианта точности вершин (VertexPrecision).
 *
 * Скрипты (`scripts/`) намеренно вне охвата: они ходят не по модели актора, а
 * по сырым таблицам БД (`resource.resourceType === 'height'` при обходе
 * `Resources`), где `heightPathOf` неприменима по типу аргумента.
 */
const HEIGHT_QUERY = /resourceType['"]\s*,\s*['"]height['"]/

const SOURCE_ROOT = join(process.cwd(), 'src')
const CANONICAL = join('core', 'terrain', 'heightPath.ts')

function sourceFiles(directory: string): string[] {
  const out: string[] = []

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name)

    if (entry.isDirectory()) out.push(...sourceFiles(full))
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full)
  }

  return out
}

describe('heightPathOf: единственное место чтения height-пути', () => {
  it('запрос ресурса высот встречается в src ровно один раз — в самой heightPathOf', () => {
    const offenders = sourceFiles(SOURCE_ROOT)
      .filter((file) => HEIGHT_QUERY.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SOURCE_ROOT, file))

    expect(offenders).toEqual([CANONICAL])
  })
})
