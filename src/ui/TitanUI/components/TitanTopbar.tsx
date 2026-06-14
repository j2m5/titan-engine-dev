import { FC } from 'react'
import { TitanTopbarProps } from '@titanui/types'

const TitanTopbar: FC<TitanTopbarProps> = ({ children, style = {} }) => {
  return (
    <div className="titan-topbar" style={style}>
      {children}
    </div>
  )
}

export default TitanTopbar
