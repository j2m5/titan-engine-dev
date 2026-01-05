export interface AppConfig {
  name: string
}

export const app: AppConfig = {
  name: import.meta.env.VITE_APP_NAME
}
