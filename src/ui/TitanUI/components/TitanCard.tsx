import { FC } from 'react'
import { TitanCardProps } from '@titanui/types'
import TitanContainer from '@titanui/components/TitanContainer'
import TitanDivider from '@titanui/components/TitanDivider'

const TitanCard: FC<TitanCardProps> = ({ header, content, footer, media = null }) => {
  return (
    <TitanContainer>
      <div className="titan-card">
        <div className="titan-card-header">{header}</div>
        <TitanDivider />
        <div className="titan-card-content">
          {media}
          {content}
        </div>
        <TitanDivider />
        <div className="titan-card-footer">{footer}</div>
      </div>
    </TitanContainer>
  )
}

export default TitanCard
