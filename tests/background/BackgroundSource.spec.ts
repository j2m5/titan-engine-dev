import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolveBackgroundSource } from '@/config/background'

describe('источник неба из окружения сборки', () => {
  it('по умолчанию — небо Gaia', () => {
    expect(resolveBackgroundSource(undefined)).toBe('gaia')
  })

  it('VITE_SKY_SOURCE=cubemap — прежняя кубмапа', () => {
    expect(resolveBackgroundSource('cubemap')).toBe('cubemap')
  })

  it('публичное демо собирается на небе Gaia: тайлы в бакете по манифесту облака', () => {
    const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8')
    const value = /VITE_SKY_SOURCE:\s*(\S+)/.exec(workflow)?.[1]

    expect(resolveBackgroundSource(value)).toBe('gaia')
  })
})
