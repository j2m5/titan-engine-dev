import { FC } from 'react'
import { TitanContainerProps } from '@titanui/types'
import { sizeStyle } from '@titanui/utils/helpers'

const TitanContainer: FC<TitanContainerProps> = ({ children, height, width, style = {} }) => {
  return (
    <div className="titan-container" style={{ ...style, ...sizeStyle(width, height) }}>
      <span className="corner tl"></span>
      <span className="corner tr"></span>
      <span className="corner bl"></span>
      <span className="corner br"></span>
      {children}
    </div>
  )
}

export default TitanContainer
