import { IVisible } from '@/ui/interfaces/IVisible'
import { ReactNode } from 'react'

interface ModalWindowProps extends IVisible {
  title: string
  content: ReactNode
  keepMounted: boolean
  close(value: boolean): void
}

export { ModalWindowProps }
