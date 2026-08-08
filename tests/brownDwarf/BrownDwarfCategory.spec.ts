import { Categories } from '@storage/database'
import { AllowedCategories } from '@/core/models/types'

describe('категория brownDwarf', () => {
  it('заведена в таблице под id 8', () => {
    const category = Categories.find((c) => c.alias === 'brownDwarf')

    expect(category).toBeDefined()
    expect(category!.id).toBe(8)
    expect(category!.name).toBe('Brown dwarf')
  })

  it('объявлена в AllowedCategories', () => {
    // CategoriesIntegrity проверяет обратное направление (таблица -> enum);
    // здесь фиксируется, что алиас вообще существует как ключ
    expect(Object.keys(AllowedCategories)).toContain('brownDwarf')
  })
})
