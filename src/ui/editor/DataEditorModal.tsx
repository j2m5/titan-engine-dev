import { FC, useState } from 'react'
import { Closable } from '@titanui/types'
import ModalWindow from '@/ui/components/common/ModalWindow'
import TitanInput from '@titanui/components/TitanInput'
import TitanTextarea from '@titanui/components/TitanTextarea'
import TitanSelect from '@titanui/components/TitanSelect'
import TitanButton from '@titanui/components/TitanButton'
import TitanFlex from '@titanui/components/TitanFlex'
import { saveDatabaseFiles } from '@/ui/editor/saveDatabaseFiles'

const DataEditorModal: FC<Closable & { visible: boolean }> = ({ visible, onClose }) => {
  const [name, setName] = useState('Sample Actor')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('#6495ed')
  const [category, setCategory] = useState('7')
  const [parent, setParent] = useState('')
  const [mass, setMass] = useState<string>('5.9736e24')

  const [status, setStatus] = useState<string>('')

  const handleTestTransport = async (): Promise<void> => {
    setStatus('Writing…')
    const result = await saveDatabaseFiles([
      {
        path: 'storage/database/generated/_smoke.ts',
        content: `// transport smoke test\nexport const Smoke = ${Date.now()}\n`
      }
    ])
    setStatus(result.ok ? `OK: wrote ${result.written?.join(', ')}` : `FAIL: ${result.error}`)
  }

  return (
    <ModalWindow visible={visible} title="Data Editor" width={560} onClose={onClose}>
      <div className="titan-form-grid">
        <TitanInput label="Name" value={name} onChange={setName} style={{ gridColumn: '1 / -1' }} />

        <TitanTextarea
          label="Description"
          value={description}
          placeholder="Short info about the object"
          onChange={setDescription}
          style={{ gridColumn: '1 / -1' }}
        />

        <TitanSelect
          label="Category"
          value={category}
          onChange={setCategory}
          options={[
            { value: '5', label: 'Black Hole' },
            { value: '6', label: 'Star' },
            { value: '7', label: 'Planet' }
          ]}
        />

        <TitanSelect
          label="Parent"
          value={parent}
          placeholder="— none —"
          onChange={setParent}
          options={[
            { value: '23', label: 'Solar System' },
            { value: '94', label: 'Sgr A*' }
          ]}
        />

        <TitanInput label="Mass (kg)" type="number" value={mass} onChange={setMass} step={1} />

        <TitanInput label="Color" type="color" value={color} onChange={setColor} />
      </div>

      <TitanDividerSpacer />

      <TitanFlex align="center" style={{ gap: '10px', justifyContent: 'space-between' }}>
        <span style={{ color: '#bbbbbb', fontSize: '12px' }}>{status}</span>
        <TitanButton onClick={handleTestTransport}>Test transport</TitanButton>
      </TitanFlex>
    </ModalWindow>
  )
}

const TitanDividerSpacer: FC = () => <div style={{ height: '14px' }} />

export default DataEditorModal
