import { FC } from 'react'
import { TitanCardProps } from '@titanui/types'
import TitanContainer from '@titanui/components/TitanContainer'
import TitanDivider from '@titanui/components/TitanDivider'

const TitanCard: FC<TitanCardProps> = ({ header, content, footer, media = null }) => {
  return (
    // Контейнер — flex-колонка: в ряду сетки он растянут по самой высокой
    // карточке, и карточка тянется следом — подвалы ряда стоят на одной линии
    <TitanContainer style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="titan-card">
        <div className="titan-card-header">{header}</div>
        <TitanDivider />
        <div className="titan-card-content">
          {media}
          {content && <div className="titan-card-text">{content}</div>}
        </div>
        <TitanDivider />
        <div className="titan-card-footer">{footer}</div>
      </div>
    </TitanContainer>
  )
}

export default TitanCard
