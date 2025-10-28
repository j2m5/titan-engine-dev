import { createContext, PropsWithChildren, useContext } from 'react'
import { Container } from 'inversify'

export const InversifyContext = createContext<Container | null>(null)
export const InversifyProvider = ({ container, children }: PropsWithChildren<{ container: Container }>) => {
  return <InversifyContext.Provider value={container}>{children}</InversifyContext.Provider>
}

export const useInjection = <T,>(identifier: string): T => {
  const container = useContext(InversifyContext)
  if (!container) {
    throw new Error('Inversify container not found in context')
  }
  return container.get<T>(identifier)
}
