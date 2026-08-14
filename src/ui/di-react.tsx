import { PropsWithChildren } from 'react'
import { Container } from '@/core/framework/container/Container'
import { DiContext } from '@/ui/di-context'

export const DiProvider = ({ container, children }: PropsWithChildren<{ container: Container }>) => {
  return <DiContext.Provider value={container}>{children}</DiContext.Provider>
}
