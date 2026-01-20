import { useCallback, useState } from 'react'
import { SaveFunction } from '@/ui/types'
import { notificationStore } from '@/ui/mobx/NotificationStore'

export function useDebounce(
  initialValue: string,
  delay: number,
  saveFunction: SaveFunction
): [string, (newValue: string) => void] {
  const [value, setValue] = useState<string>(initialValue)

  const debouncedSave = useCallback(
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

function debounce(fn: (...args: any[]) => void, delay: number): (...args: any[]) => void {
  let timer: NodeJS.Timeout | null = null

  return function (...args: any[]) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}
