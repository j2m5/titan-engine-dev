import { createContext, PropsWithChildren, useContext } from 'react'
import { Container, ServiceKey } from '@/core/framework/container/Container'

const DiContext = createContext<Container | null>(null)

export const DiProvider = ({ container, children }: PropsWithChildren<{ container: Container }>) => {
  return <DiContext.Provider value={container}>{children}</DiContext.Provider>
}

export const useInjection = <T,>(key: ServiceKey<T>): T => {
  const container = useContext(DiContext)

  if (!container) {
    throw new Error('DI container not found in React context. Wrap the tree in <DiProvider>.')
  }

  return container.get(key)
}
