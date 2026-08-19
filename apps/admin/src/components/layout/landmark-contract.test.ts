import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const consoleContentFiles = [
  '../../app/(console)/page.tsx',
  '../../app/(console)/access/page.tsx',
  '../../app/(console)/forbidden/page.tsx',
  '../data/data-page.tsx',
  '../data/detail-page.tsx',
] as const

describe('Console landmark contract', () => {
  it.each(consoleContentFiles)(
    'keeps SidebarInset as the only main landmark in %s',
    (relativePath) => {
      const source = readFileSync(
        new URL(relativePath, import.meta.url),
        'utf8'
      )

      expect(source).not.toMatch(/<main(?:\s|>)/)
    }
  )
})
