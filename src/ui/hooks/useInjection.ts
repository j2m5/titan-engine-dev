import { useContext } from 'react'
import { ServiceKey } from '@/core/framework/container/Container'
import { DiContext } from '@/ui/di-context'

export const useInjection = <T,>(key: ServiceKey<T>): T => {
  const container = useContext(DiContext)

  if (!container) {
    throw new Error('DI container not found in React context. Wrap the tree in <DiProvider>.')
  }

  return container.get(key)
}
