import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import DashboardPage from './page'

describe('DashboardPage responsive audit', () => {
  it('provides a mobile audit list alongside the desktop table', () => {
    render(<DashboardPage />)

    const mobileAudit = screen.getByRole('list', { name: '最近审计' })

    expect(within(mobileAudit).getAllByRole('listitem')).toHaveLength(4)
    expect(screen.getByRole('table')).not.toBeNull()
  })
})
