import { createContext } from 'react'
import { Container } from '@/core/framework/container/Container'

/**
 * Контекст DI живёт отдельно от провайдера: файл с JSX-компонентом обязан
 * экспортировать только компоненты, иначе ломается fast refresh.
 */
export const DiContext = createContext<Container | null>(null)
