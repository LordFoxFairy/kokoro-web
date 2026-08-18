import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNavigate } from './core'

const router = {
  back: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
}

describe('Next navigation boundary', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses push by default and forwards explicit scroll behavior', () => {
    const navigate = createNavigate(router)

    navigate.to('/users')
    navigate.to('/users/42', { scroll: false })

    expect(router.push).toHaveBeenNthCalledWith(1, '/users', undefined)
    expect(router.push).toHaveBeenNthCalledWith(2, '/users/42', {
      scroll: false,
    })
  })

  it('supports replacement and browser-level navigation commands', () => {
    const navigate = createNavigate(router)

    navigate.to('/login', { replace: true })
    navigate.back()
    navigate.refresh()

    expect(router.replace).toHaveBeenCalledWith('/login', undefined)
    expect(router.back).toHaveBeenCalledOnce()
    expect(router.refresh).toHaveBeenCalledOnce()
  })
})
