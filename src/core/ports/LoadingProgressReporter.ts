/** Выходной порт: ядро сообщает прогресс загрузки ресурсов. */
export interface LoadingProgressReporter {
  setAsset(url: string): void
  setProgress(loaded: number): void
  setTotal(total: number): void
}
