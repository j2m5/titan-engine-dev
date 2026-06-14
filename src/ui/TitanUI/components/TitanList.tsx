import { FC } from 'react'
import { Customizable, HasChildren } from '@titanui/types'
import TitanContainer from '@titanui/components/TitanContainer'

const TitanList: FC<HasChildren & Customizable> = ({ children, style = {} }) => {
  return (
    <TitanContainer style={style}>
      <div className="titan-list">{children}</div>
    </TitanContainer>
  )
}

export default TitanList
