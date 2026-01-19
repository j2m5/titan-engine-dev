import { FC } from 'react'
import { Customizable, HasChildren } from '@/ui/TitanUI/types'

const TitanSimpleList: FC<HasChildren & Customizable> = ({ children, style = {} }) => {
  return (
    <div className="titan-list" style={style}>
      {children}
    </div>
  )
}

export default TitanSimpleList
