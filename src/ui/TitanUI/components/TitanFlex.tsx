import { FC } from 'react'
import { sizeStyle } from '@titanui/utils/helpers'
import { TitanFlexProps } from '@titanui/types'

const TitanFlex: FC<TitanFlexProps> = ({ children, align = 'start', justify = 'start', height, width, style = {} }) => {
  return (
    <div className={`titan-flex align-${align} justify-${justify}`} style={{ ...style, ...sizeStyle(width, height) }}>
      {children}
    </div>
  )
}

export default TitanFlex
