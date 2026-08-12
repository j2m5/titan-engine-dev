import { useMemo, useState } from 'react'
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

  const handleChange = (newValue: string) => {
    setValue(newValue)
    debouncedSave(newValue)
  }

  return [value, handleChange]
}

function debounce<TArgs extends unknown[]>(fn: (...args: TArgs) => void, delay: number): (...args: TArgs) => void {
  let timer: ReturnType<typeof setTimeout> | null = null

  return function (...args: TArgs) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}
