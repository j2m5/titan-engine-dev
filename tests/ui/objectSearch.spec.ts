import { filterByName } from '@/ui/components/common/objectSearch'

const bodies = [{ name: 'Mars' }, { name: 'Phobos' }, { name: 'Deimos' }, { name: 'Earth' }]
const names = (query: string): string[] => filterByName(bodies, query, (b) => b.name).map((b) => b.name)

describe('filterByName: поиск по имени в списке объектов', () => {
  it('подстрока без учёта регистра', () => {
    expect(names('OS')).toEqual(['Phobos', 'Deimos'])
  })

  it('пробелы по краям запроса не мешают', () => {
    expect(names('  mars ')).toEqual(['Mars'])
  })

  it('пустой запрос и одни пробелы — весь список в прежнем порядке', () => {
    expect(names('')).toEqual(['Mars', 'Phobos', 'Deimos', 'Earth'])
    expect(names('   ')).toEqual(['Mars', 'Phobos', 'Deimos', 'Earth'])
  })

  it('нет совпадений — пустой результат', () => {
    expect(names('jupiter')).toEqual([])
  })
})
