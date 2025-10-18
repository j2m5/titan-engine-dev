import { useCallback, useState } from 'react'
import { notificationStore } from '@/ui/mobX/NotificationStore'

export type SaveFunction = (value: string) => void

export type TrackMetadata = {
  title: string
  artist: string
  album: string
}

export function useDebounce(
  initialValue: string,
  delay: number,
  saveFunction: SaveFunction
): [string, (newValue: string) => void] {
  const [value, setValue] = useState<string>(initialValue)

  const debouncedSave = useCallback(
    debounce((newValue: string) => {
      saveFunction(newValue)
      notificationStore.openNotification({ type: 'success', message: 'Changes saved' })
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
