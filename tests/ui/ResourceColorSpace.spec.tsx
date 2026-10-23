import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import path from 'node:path'
import ts from 'typescript'
import { ColorManagement, CubeTexture, LinearSRGBColorSpace, NoColorSpace, SRGBColorSpace, Texture, type WebGLRenderer } from 'three'
import { TablePanel } from '@/ui/editor/TablePanel'
import { useEditorDraft, type UseEditorDraft } from '@/ui/editor/useEditorDraft'
import { resourcesSpec } from '@/ui/editor/forms/resourceSpecs'
import type { GeneratedFile } from '@/core/framework/generation/generateDatabaseFiles'
import { applyTextureParameters } from '@/core/textures/applyTextureParameters'

const { saveSpy } = vi.hoisted(() => ({ saveSpy: vi.fn() }))
vi.mock('@/ui/editor/saveDatabaseFiles', () => ({ saveDatabaseFiles: saveSpy }))

let container: HTMLDivElement
let root: Root
let editor: UseEditorDraft

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  saveSpy.mockReset().mockResolvedValue({ ok: true, written: ['resources.ts'] })
})
afterEach(() => { act(() => root.unmount()); container.remove() })

function mount(colorSpace?: unknown): HTMLSelectElement {
  const database = new Map<string, unknown[]>([
    ['resources', [{ id: 1, resourceType: 'diffuse', lifecycle: 'streamable', path: 'image.webp',
      ...(colorSpace === undefined ? {} : { colorSpace }) }]]
  ])
  function Editor() {
    editor = useEditorDraft(database, [])
    return <TablePanel spec={resourcesSpec} editor={editor} />
  }
  act(() => root.render(<Editor />))
  act(() => container.querySelector<HTMLElement>('.titan-editor-row')!.click())
  const select = Array.from(container.querySelectorAll('label')).find((label) =>
    label.querySelector('.titan-field-label')?.textContent === 'Color space')!.querySelector('select')
  expect(select).not.toBeNull()
  return select!
}

function choose(select: HTMLSelectElement, value: string): void {
  act(() => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function expectCompilable(files: GeneratedFile[]): void {
  // Compile every actual save payload against the project's IResource, without writing database files.
  const sources = new Map(files.map((file, index) => [path.resolve(`test-results/color-space-${index}.ts`), file.content]))
  const options: ts.CompilerOptions = {
    strict: true, noEmit: true, skipLibCheck: true, types: [], target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Node10,
    baseUrl: process.cwd(), paths: { '@/*': ['src/*'] }
  }
  const host = ts.createCompilerHost(options)
  const getSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (file, version, onError, recreate) => {
    const content = sources.get(path.resolve(file))
    return content === undefined ? getSourceFile(file, version, onError, recreate)
      : ts.createSourceFile(file, content, version)
  }
  const program = ts.createProgram([...sources.keys()], options, host)
  expect(ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([])
}

it.each([undefined, NoColorSpace, SRGBColorSpace, LinearSRGBColorSpace])(
  'displays the stored color space %j without changing it', (colorSpace) => {
    const select = mount(colorSpace)
    expect(editor.draft.resources[0].colorSpace).toBe(colorSpace)
    if (colorSpace === undefined) {
      expect(select.selectedOptions[0].textContent).toBe('— none —')
      expect(select.value).not.toBe(NoColorSpace)
    } else {
      expect(select.value).toBe(colorSpace)
      expect(select.selectedOptions[0].textContent).not.toBe('— none —')
    }
  })

// Real TypeScript compilation loads project/dependency declarations under parallel worker load.
it('preserves omission and explicit NoColorSpace through editing, save, compilation and texture parameters', { timeout: 30_000 }, async () => {
  const select = mount()
  const unset = select.value
  const exported: GeneratedFile[] = []
  for (const colorSpace of [undefined, NoColorSpace, undefined, SRGBColorSpace, LinearSRGBColorSpace]) {
    choose(select, colorSpace === undefined ? unset : colorSpace)
    expect(editor.draft.resources[0].colorSpace).toBe(colorSpace)
    expect(editor.validation.errors).toEqual([])
    await act(async () => editor.save())
    const file = (saveSpy.mock.lastCall![0] as GeneratedFile[]).find((entry) => /\/resources\.ts$/.test(entry.path))!
    expect(file.content.includes('colorSpace:')).toBe(colorSpace !== undefined)
    if (colorSpace !== undefined) expect(file.content).toContain(`colorSpace: ${JSON.stringify(colorSpace)}`)
    exported.push(file)

    const cube = new CubeTexture()
    cube.colorSpace = SRGBColorSpace // CubeTextureLoader's default.
    const image = new Texture()
    for (const [texture, inherited] of [[image, NoColorSpace], [cube, SRGBColorSpace]] as const) {
      try {
        applyTextureParameters(texture,
          { name: 'image', paths: ['image.webp'], resourceType: 'diffuse', params: editor.draft.resources[0] },
          { capabilities: { getMaxAnisotropy: () => 16 } } as WebGLRenderer)
        expect(texture.colorSpace).toBe(colorSpace === undefined ? inherited : colorSpace)
        expect(() => ColorManagement.getTransfer(texture.colorSpace)).not.toThrow()
      } finally { texture.dispose() }
    }
  }
  expect(saveSpy).toHaveBeenCalledTimes(5)
  expectCompilable(exported)
})

it('blocks a previously stored invalid value until the user selects a valid color space', async () => {
  const select = mount('sRGB')
  await act(async () => editor.save())
  expect(saveSpy).not.toHaveBeenCalled()
  expect(editor.validation.errors.some((error) => error.message.includes('colorSpace'))).toBe(true)
  choose(select, SRGBColorSpace)
  await act(async () => editor.save())
  expect(saveSpy).toHaveBeenCalledTimes(1)
  expect(editor.validation.errors).toEqual([])
})
