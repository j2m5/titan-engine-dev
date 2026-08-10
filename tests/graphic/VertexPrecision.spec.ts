import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Инвариант точности вершин на ВЕСЬ движок, а не на перечисленные шейдеры.
 *
 * gl_Position обязана считаться через modelViewMatrix. Три собирает её на CPU в
 * double, и абсолютный мировой сдвиг тела сокращается с позицией камеры ДО
 * спуска во float32. Перемножение modelMatrix и viewMatrix уже в шейдере
 * оставляет промежуточную мировую величину, и вершины квантуются шагом её ULP.
 *
 * Насколько это видно — зависит от того, как далеко тело от начала своей
 * системы. Пойманные случаи: белый карлик Sirius B (994 000 юнитов от
 * барицентра при радиусе 2.93 — 49 ступеней на радиус, гранёный шар) и
 * протуберанцы Сириуса A (ULP 0.029 при полутолщине ленты 0.51 — полтора
 * десятка ступеней, рябь на лентах). Тела в начале координат дефекта не
 * показывают вовсе, поэтому глазом он ловится выборочно и легко уходит в релиз.
 *
 * Файлы читаются с диска, а не импортируются: список шейдеров иначе пришлось бы
 * поддерживать руками, и новый шейдер въехал бы мимо проверки.
 *
 * Ловушка для того, кто будет править: `modelViewMatrix` НЕ содержит подстрок
 * `modelMatrix` и `viewMatrix` — регистр букв V и M их разводит. Поэтому
 * простого includes достаточно и словарные границы не нужны.
 */

const SHADER_ROOT: string = join(process.cwd(), 'src')

function collectTypeScriptFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full: string = join(dir, entry.name)

    if (entry.isDirectory()) collectTypeScriptFiles(full, out)
    else if (entry.name.endsWith('.ts')) out.push(full)
  }

  return out
}

interface Assignment {
  file: string
  expression: string
}

function collectGlPositionAssignments(): Assignment[] {
  const found: Assignment[] = []

  for (const file of collectTypeScriptFiles(SHADER_ROOT)) {
    const source: string = readFileSync(file, 'utf8')

    for (const match of source.matchAll(/gl_Position\s*=\s*([^;]*);/g)) {
      found.push({ file: relative(process.cwd(), file), expression: match[1].replace(/\s+/g, ' ').trim() })
    }
  }

  return found
}

describe('точность вершин: gl_Position во всех шейдерах движка', () => {
  const assignments: Assignment[] = collectGlPositionAssignments()

  it('шейдеры вообще найдены — иначе проверка молча пустая', () => {
    // Без этого переезд каталога или смена расширения превратили бы весь блок
    // в зелёный ноль проверок
    expect(assignments.length).toBeGreaterThan(8)
  })

  it('ни одна не собирает позицию из мировых матриц', () => {
    const offenders: string[] = assignments
      .filter(({ expression }) => expression.includes('modelMatrix') || expression.includes('viewMatrix'))
      .map(({ file, expression }) => `${file}: gl_Position = ${expression};`)

    expect(offenders).toEqual([])
  })
})
