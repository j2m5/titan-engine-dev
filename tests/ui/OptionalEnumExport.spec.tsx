import { act } from 'react'
import { createRoot } from 'react-dom/client'
import ts from 'typescript'
import path from 'node:path'
import { TablePanel } from '@/ui/editor/TablePanel'
import { useEditorDraft, type UseEditorDraft } from '@/ui/editor/useEditorDraft'
import { rotationObjectsSpec, placementsSpec } from '@/ui/editor/forms/tableSpecs'
import type { TableSpec } from '@/ui/editor/forms/fieldSpec'
import { generateDatabaseFiles } from '@/core/framework/generation/generateDatabaseFiles'
import { shippedSnapshot } from '../helpers/shippedSnapshot'

// Real TypeScript compilation loads project/dependency declarations under parallel worker load.
it('clears optional enums through the real form and exports compilable database files', { timeout: 30_000 }, async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const db = await shippedSnapshot()
  const database = new Map<string, unknown[]>(Object.entries(db))
  let editor: UseEditorDraft
  function Editor({ spec }: { spec: TableSpec }) {
    editor = useEditorDraft(database, [])
    return <TablePanel key={spec.table} spec={spec} editor={editor} />
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  try {
    for (const [spec, field, selected] of [
      [rotationObjectsSpec, 'direction', '-1'], [placementsSpec, 'lagrange', '4']
    ] as const) {
      act(() => root.render(<Editor spec={spec} />))
      act(() => container.querySelector<HTMLElement>('.titan-list-item')!.click())
      const label = spec.fields.find((item) => item.key === field)!.label
      const select = Array.from(container.querySelectorAll('select')).find((item) =>
        item.closest('label')?.textContent?.includes(label))!
      for (const value of [selected, '']) {
        act(() => {
          select.value = value
          select.dispatchEvent(new Event('change', { bubbles: true }))
        })
      }
      const row = editor!.draft[spec.table][0] as unknown as Record<string, unknown>
      expect(row[field]).toBeUndefined()
      expect(select.value).toBe('')
    }

    expect(editor!.validation.ok).toBe(true)
    const files = generateDatabaseFiles(editor!.draft).filter((file) =>
      /\/(rotationObjects|placements)\.ts$/.test(file.path))
    const normalize = (file: string): string => path.resolve(file).replaceAll('\\', '/')
    const sources = new Map(files.map((file) => [normalize(file.path), file.content]))
    const options: ts.CompilerOptions = {
      strict: true, noEmit: true, skipLibCheck: true, types: [], target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Node10,
      baseUrl: process.cwd(), paths: { '@/*': ['src/*'] }
    }
    const host = ts.createCompilerHost(options)
    const getSourceFile = host.getSourceFile.bind(host)
    host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => {
      const content = sources.get(normalize(file))
      return content === undefined ? getSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile)
        : ts.createSourceFile(file, content, languageVersion)
    }
    const program = ts.createProgram([...sources.keys()], options, host)
    const diagnostics = ts.getPreEmitDiagnostics(program)
    expect(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([])
  } finally {
    act(() => root.unmount())
    container.remove()
  }
})
