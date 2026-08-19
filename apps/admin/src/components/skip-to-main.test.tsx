import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SkipToMain } from './skip-to-main'

describe('SkipToMain', () => {
  it('moves focus to the main content target', () => {
    render(
      <>
        <SkipToMain />
        <main id='main-content' tabIndex={-1}>
          内容
        </main>
      </>
    )

    fireEvent.click(screen.getByRole('link', { name: '跳到主要内容' }))

    expect(document.activeElement).toBe(screen.getByRole('main'))
  })

  it('moves focus to the main content target when Enter keydown', () => {
    render(
      <>
        <SkipToMain />
        <main id='main-content' tabIndex={-1}>
          内容
        </main>
      </>
    )

    fireEvent.keyDown(screen.getByRole('link', { name: '跳到主要内容' }), {
      key: 'Enter',
      code: 'Enter',
      charCode: 13,
    })

    expect(document.activeElement).toBe(screen.getByRole('main'))
  })

  it('moves focus to the main content target when Space keydown', () => {
    render(
      <>
        <SkipToMain />
        <main id='main-content' tabIndex={-1}>
          内容
        </main>
      </>
    )

    fireEvent.keyDown(screen.getByRole('link', { name: '跳到主要内容' }), {
      key: ' ',
      code: 'Space',
      charCode: 32,
    })

    expect(document.activeElement).toBe(screen.getByRole('main'))
  })

  it('moves focus to the main content target when Enter keyup', () => {
    render(
      <>
        <SkipToMain />
        <main id='main-content' tabIndex={-1}>
          内容
        </main>
      </>
    )

    fireEvent.keyUp(screen.getByRole('link', { name: '跳到主要内容' }), {
      key: 'Enter',
      code: 'Enter',
      charCode: 13,
    })

    expect(document.activeElement).toBe(screen.getByRole('main'))
  })

  it('moves focus to the main content target when Space keyup', () => {
    render(
      <>
        <SkipToMain />
        <main id='main-content' tabIndex={-1}>
          内容
        </main>
      </>
    )

    fireEvent.keyUp(screen.getByRole('link', { name: '跳到主要内容' }), {
      key: ' ',
      code: 'Space',
      charCode: 32,
    })

    expect(document.activeElement).toBe(screen.getByRole('main'))
  })
})
