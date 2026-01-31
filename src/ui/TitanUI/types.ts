import React, { RefObject } from 'react'

export type FlexAlignValues = 'start' | 'end' | 'center' | 'stretch' | 'baseline'

export type FlexJustifyValues = 'start' | 'end' | 'center' | 'between' | 'around' | 'evenly'

export type AlertType = 'info' | 'warning' | 'error' | 'success'

export interface HasChildren<T = React.ReactNode> {
  children: T
}

export interface Clickable<T = HTMLButtonElement> {
  onClick?: React.MouseEventHandler<T> | undefined
}

export interface Closable {
  onClose?(): void
}

export interface Resizable {
  height?: string | number
  width?: string | number
}

export interface Customizable {
  style?: React.CSSProperties
}

export interface TitanContainerProps extends HasChildren, Resizable, Customizable {}

export interface TitanLabelProps extends HasChildren {
  size?: number
}

export interface TitanButtonProps extends HasChildren, Resizable, Clickable {}

export interface TitanTopbarProps extends HasChildren, Customizable {}

export interface TitanCardProps {
  header: React.ReactNode
  content: React.ReactNode
  footer: React.ReactNode
  media?: React.ReactNode
}

export interface TitanPopupProps {
  visible: boolean
  anchor: RefObject<React.ReactNode>
  left?: number
  right?: number
  header?: string
  content?: string
}

export interface TitanModalProps extends HasChildren, Resizable {
  visible: boolean
  title: string
  actions: React.ReactNode
  keepMounted?: boolean
}

export interface TitanDividerProps {
  offsetTop?: number
  offsetBottom?: number
}

export interface TitanListItemProps extends HasChildren, Customizable, Clickable<HTMLDivElement> {
  icon?: React.ReactNode
}

export interface TitanFlexProps extends HasChildren, Resizable, Customizable {
  align?: FlexAlignValues
  justify?: FlexJustifyValues
}

export interface TitanGridProps extends HasChildren {
  min?: number
  gap?: number
}

export interface TitanSliderProps extends Customizable {
  value: number
  min?: number
  max?: number
  step?: number
  buffer?: number
  disabled?: boolean
  onChange(event: React.ChangeEvent): void
}

export interface TitanToastProps extends HasChildren, Customizable {
  visible: boolean
  duration?: number
  onClose(): void
}

export interface TitanAlertProps {
  type: AlertType
  message: string
  showIcon?: boolean
}
