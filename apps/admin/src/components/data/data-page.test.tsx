import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DataPage } from './data-page'
import { DetailPage } from './detail-page'

describe('DataPage actions', () => {
  it('omits an action label that has no executable behavior', () => {
    render(
      <DataPage
        title='用户管理'
        description='管理用户'
        actionLabel='创建用户'
        columns={['用户']}
        rows={[]}
      />
    )

    expect(screen.queryByRole('button', { name: '创建用户' })).toBeNull()
    expect(screen.queryByRole('link', { name: '创建用户' })).toBeNull()
  })

  it('renders and executes a configured action handler', () => {
    const onAction = vi.fn()

    render(
      <DataPage
        title='用户管理'
        description='管理用户'
        actionLabel='创建用户'
        onAction={onAction}
        columns={['用户']}
        rows={[]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '创建用户' }))
    expect(onAction).toHaveBeenCalledOnce()
  })
})

describe('DetailPage state and actions', () => {
  const detailProps = {
    backHref: '/users',
    backLabel: '返回用户列表',
    title: 'Ada',
    subtitle: 'ada@example.test',
    status: 'suspended',
    fields: [{ label: '用户 ID', value: 'usr_ada' }],
  } as const

  it('localizes status and omits a menu with no executable actions', () => {
    render(<DetailPage {...detailProps} />)

    expect(screen.getByText('已停用')).not.toBeNull()
    expect(screen.queryByText('suspended')).toBeNull()
    expect(screen.queryByRole('button', { name: '更多操作' })).toBeNull()
  })

  it('renders only configured actions and executes their behavior', () => {
    const onSuspend = vi.fn()

    render(
      <DetailPage
        {...detailProps}
        actions={[
          { label: '编辑', href: '/users/usr_ada/edit' },
          { label: '停用', variant: 'destructive', onSelect: onSuspend },
          { label: '无行为' },
        ]}
      />
    )

    fireEvent.pointerDown(screen.getByRole('button', { name: '更多操作' }), {
      button: 0,
      ctrlKey: false,
    })

    expect(
      screen.getByRole('menuitem', { name: '编辑' }).getAttribute('href')
    ).toBe('/users/usr_ada/edit')
    expect(screen.queryByRole('menuitem', { name: '无行为' })).toBeNull()

    fireEvent.click(screen.getByRole('menuitem', { name: '停用' }))
    expect(onSuspend).toHaveBeenCalledOnce()
  })
})
