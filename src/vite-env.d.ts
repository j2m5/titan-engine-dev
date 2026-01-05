/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_NAME: string
  readonly VITE_FS_DRIVER: 'local' | 's3'
  readonly VITE_FILE_BUCKET: string
  readonly VITE_S3_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
