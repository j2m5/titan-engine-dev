import { useEffect, useMemo, useState } from 'react'
import { SaveFunction } from '@/ui/types'
import { notificationStore } from '@/ui/mobx/NotificationStore'

export function useDebounce(
  initialValue: string,
  delay: number,
  saveFunction: SaveFunction
): [string, (newValue: string) => void] {
  const [value, setValue] = useState<string>(initialValue)

  const debouncedSave = useMemo(
    () =>
      debounce((newValue: string) => {
        saveFunction(newValue)
        notificationStore.dispatch({ type: 'success', message: 'Changes saved' })
      }, delay),
    [saveFunction, delay]
  )

  // Уход компонента или смена функции сохранения: отложенная правка
  // сохраняется сразу и той функцией, для которой сделана, — не теряется и
  // не стреляет после размонтирования
  useEffect(() => () => debouncedSave.flush(), [debouncedSave])

  const handleChange = (newValue: string) => {
    setValue(newValue)
    debouncedSave(newValue)
  }

  return [value, handleChange]
}

interface Debounced<TArgs extends unknown[]> {
  (...args: TArgs): void
  /** Выполнить отложенный вызов немедленно; без отложенного — ничего */
  flush(): void
}

function debounce<TArgs extends unknown[]>(fn: (...args: TArgs) => void, delay: number): Debounced<TArgs> {
  let timer: number | null = null
  let pending: TArgs | null = null

  const flush = (): void => {
    if (timer !== null) window.clearTimeout(timer)
    timer = null
    const args = pending
    pending = null
    if (args) fn(...args)
  }

  const debounced = (...args: TArgs): void => {
    pending = args
    if (timer !== null) window.clearTimeout(timer)
    timer = window.setTimeout(flush, delay)
  }

  return Object.assign(debounced, { flush })
}
