import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolveBackgroundSource } from '@/config/background'

describe('источник неба из окружения сборки', () => {
  it('по умолчанию — небо Gaia: тайлы лежат локально', () => {
    expect(resolveBackgroundSource(undefined)).toBe('gaia')
  })

  it('VITE_SKY_SOURCE=cubemap — прежняя кубмапа', () => {
    expect(resolveBackgroundSource('cubemap')).toBe('cubemap')
  })

  it('публичное демо собирается на кубмапе: тайлов Gaia в бакете нет', () => {
    const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8')

    expect(workflow).toMatch(/VITE_SKY_SOURCE:\s*cubemap/)
  })
})
