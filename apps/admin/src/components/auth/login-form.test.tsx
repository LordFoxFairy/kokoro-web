import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { LoginInput, LoginResult } from '@/lib/auth/login'
import { LoginForm } from './login-form'

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => router }))

type LoginAction = (input: LoginInput) => Promise<LoginResult>

describe('LoginForm', () => {
  it('renders an unavailable alert instead of a password form when disabled', () => {
    render(
      <LoginForm
        callbackUrl='/'
        credentialsEnabled={false}
        action={vi.fn() as unknown as LoginAction}
      />
    )

    expect(screen.queryByRole('textbox', { name: '账号' })).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain(
      '当前环境未配置可用的登录方式'
    )
  })

  it('shows client validation without calling the server action', async () => {
    const action = vi.fn<LoginAction>()
    render(
      <LoginForm callbackUrl='/users' credentialsEnabled action={action} />
    )

    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    expect(await screen.findByText('请输入账号')).toBeDefined()
    expect(await screen.findByText('请输入密码')).toBeDefined()
    expect(action).not.toHaveBeenCalled()
  })

  it('shows a generic structured credentials error', async () => {
    const action = vi.fn<LoginAction>(async () => ({
      ok: false,
      code: 'AUTH_INVALID_CREDENTIALS',
      fieldErrors: {},
    }))
    render(<LoginForm callbackUrl='/' credentialsEnabled action={action} />)

    fireEvent.change(screen.getByRole('textbox', { name: '账号' }), {
      target: { value: 'admin' },
    })
    fireEvent.change(screen.getByLabelText('密码'), {
      target: { value: 'wrong' },
    })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    expect((await screen.findByRole('alert')).textContent).toContain(
      '账号或密码不正确'
    )
  })

  it('replaces the route and refreshes after successful authentication', async () => {
    const action = vi.fn<LoginAction>(async () => ({
      ok: true,
      redirectTo: '/users?page=2',
    }))
    render(
      <LoginForm
        callbackUrl='/users?page=2'
        credentialsEnabled
        action={action}
      />
    )

    fireEvent.change(screen.getByRole('textbox', { name: '账号' }), {
      target: { value: 'admin' },
    })
    fireEvent.change(screen.getByLabelText('密码'), {
      target: { value: 'secret' },
    })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() =>
      expect(action).toHaveBeenCalledWith({
        account: 'admin',
        password: 'secret',
        callbackUrl: '/users?page=2',
      })
    )
    expect(router.replace).toHaveBeenCalledWith('/users?page=2')
    expect(router.refresh).toHaveBeenCalledOnce()
  })
})
