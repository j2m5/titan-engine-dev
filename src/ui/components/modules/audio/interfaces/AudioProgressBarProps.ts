interface AudioProgressBarProps {
  duration: number
  currentProgress: number
  buffered: number
  onProgressChanged(value: number): void
}

export { AudioProgressBarProps }
