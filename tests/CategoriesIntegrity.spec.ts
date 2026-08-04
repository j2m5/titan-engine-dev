import { describe, it, expect } from 'vitest'
import { Categories } from '@storage/database'
import { AllowedCategories } from '@/core/models/types'

/**
 * Алиас категории в данных типизирован как AllowedCategory (ключ enum), но
 * таблица — сгенерированный литерал, и рассинхрон между ней и enum типами
 * не ловится: сравнивать их некому. Здесь ловится.
 */
const enumKeys = new Set(Object.keys(AllowedCategories).filter((key) => Number.isNaN(Number(key))))

describe('categories — целостность с AllowedCategories', () => {
  it('каждый alias таблицы объявлен в enum', () => {
    const unknown = Categories.filter((category) => !enumKeys.has(category.alias))

    expect(unknown.map((c) => `#${c.id} ${c.alias}`)).toEqual([])
  })

  it('алиасы не повторяются', () => {
    const aliases = Categories.map((c) => c.alias)

    expect(aliases).toHaveLength(new Set(aliases).size)
  })

  it('категория туманности заведена', () => {
    const nebula = Categories.find((c) => c.alias === 'nebula')

    expect(nebula).toBeDefined()
    expect(nebula!.id).toBe(7)
  })
})
