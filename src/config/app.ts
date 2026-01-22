export interface AppConfig {
  name: string
  showStats: boolean
}

export const app: AppConfig = {
  name: import.meta.env.VITE_APP_NAME,
  showStats: import.meta.env.VITE_SHOW_STATS_PANEL === 'true'
}
