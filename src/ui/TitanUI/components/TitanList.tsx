import { FC, ReactNode } from 'react'
import { Customizable, HasChildren } from '@titanui/types'
import TitanContainer from '@titanui/components/TitanContainer'

/**
 * Список с прокруткой. header рисуется над прокручиваемой областью: не
 * уезжает вместе со строками и не встаёт вплотную к скроллбару (поиск по
 * объектам).
 */
const TitanList: FC<HasChildren & Customizable & { header?: ReactNode }> = ({ children, header, style = {} }) => {
  return (
    <TitanContainer style={style}>
      {header && <div className="titan-list-header">{header}</div>}
      <div className="titan-list">{children}</div>
    </TitanContainer>
  )
}

export default TitanList
