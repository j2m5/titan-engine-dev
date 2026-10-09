/**
 * Поиск по списку объектов: подстрока имени без учёта регистра, пробелы по
 * краям запроса не в счёт. Пустой запрос — весь список в прежнем порядке.
 */
export function filterByName<T>(items: readonly T[], query: string, nameOf: (item: T) => string): T[] {
  const needle: string = query.trim().toLowerCase()

  if (!needle) return [...items]

  return items.filter((item: T): boolean => nameOf(item).toLowerCase().includes(needle))
}
