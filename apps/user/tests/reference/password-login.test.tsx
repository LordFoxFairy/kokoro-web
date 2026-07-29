import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { LocaleProvider } from "@/i18n/context"
import { PasswordLogin } from "@/ui/auth/password-login"

const { signInMock } = vi.hoisted(() => ({ signInMock: vi.fn() }))

vi.mock("next-auth/react", () => ({ signIn: signInMock }))

const fetchMock = vi.fn()

function renderLogin(transactionRef?: string) {
  return render(<PasswordLogin brandName="Acme" transactionRef={transactionRef} />, { wrapper: LocaleProvider })
}

beforeEach(() => {
  fetchMock.mockReset()
  signInMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("PasswordLogin", () => {
  it("persists the one-time delivery command before invoking Auth.js credentials", async () => {
    fetchMock.mockResolvedValue({ ok: true })
    signInMock.mockResolvedValue({ ok: false, error: "CredentialsSignin", code: "credentials" })
    renderLogin()

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@example.com" } })
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse battery staple" } })
    fireEvent.click(screen.getByRole("button", { name: /continue/i }))

    await screen.findByRole("alert")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(signInMock).toHaveBeenCalledWith("credentials", {
      flow: "login",
      email: "user@example.com",
      password: "correct horse battery staple",
      redirect: false,
    })
    expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(signInMock.mock.invocationCallOrder[0]!)
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      flow: "login",
      email: "user@example.com",
      password: "correct horse battery staple",
    })
  })

  it("advances delivery state before retrying an ambiguous credential delivery", async () => {
    fetchMock.mockResolvedValue({ ok: true })
    signInMock
      .mockResolvedValueOnce({ ok: false, error: "CredentialsSignin", code: "delivery_recovery_required" })
      .mockResolvedValueOnce({ ok: false, error: "CredentialsSignin", code: "credentials" })
    renderLogin("mfa-tx-1")

    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "123456" } })
    fireEvent.click(screen.getByRole("button", { name: /continue/i }))

    await waitFor(() => expect(signInMock).toHaveBeenCalledTimes(2))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      flow: "mfa",
      transactionRef: "mfa-tx-1",
      code: "123456",
    })
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({
      flow: "mfa",
      transactionRef: "mfa-tx-1",
      code: "123456",
      advance: true,
    })
    expect(fetchMock.mock.invocationCallOrder[1]).toBeLessThan(signInMock.mock.invocationCallOrder[1]!)
  })
})
