import { FC } from 'react'
import { Customizable, HasChildren } from '@/ui/TitanUI/types'
import TitanContainer from '@/ui/TitanUI/components/TitanContainer'

const TitanList: FC<HasChildren & Customizable> = ({ children, style = {} }) => {
  return (
    <TitanContainer style={style}>
      <div className="titan-list">{children}</div>
    </TitanContainer>
  )
}

export default TitanList
