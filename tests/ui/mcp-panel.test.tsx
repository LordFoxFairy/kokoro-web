// 连接面板组件测试：server 池渲染（official 只读 / 自有可启停软删 + enabled 徽标）+ 启停/软删重取 +
// 注册向导（既有 handle / 新建凭据）+ 错误人话化 + 凭据 tab 创建/删除。hub 客户端为注入 fake（不打网络）。
// text 输入按 placeholder 定位（wrapping label 含 hint 文，exact 不匹配）；select 按 aria-label。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { HubClientError, type HubClient } from "@/hub/client"
import type { McpSecret, McpServerView } from "@/hub/schemas"
import { LocaleProvider } from "@/i18n/context"
import { McpPanel } from "@/ui/mcp/mcp-panel"

const OFFICIAL: McpServerView = {
  scope: "official",
  name: "official-search",
  revision: 3,
  transport: "streamable_http",
  url: "https://official.example.com/mcp",
  allowed_tools: ["search"],
  secret_ref: null,
  enabled: true,
}
const OWN: McpServerView = {
  scope: "team_1",
  name: "my-tools",
  revision: 1,
  transport: "http",
  url: "https://own.example.com/mcp",
  allowed_tools: [],
  secret_ref: "handle:srt_00000000000000000000000000000001",
  enabled: true,
}
const SECRET: McpSecret = {
  handle: "srt_00000000000000000000000000000001",
  name: "search-key",
  createdAt: 1_700_000_000_000,
}

function makeClient(overrides: Partial<HubClient> = {}): HubClient {
  return {
    listSkillPool: vi.fn(),
    skillQuota: vi.fn(),
    skillRevisions: vi.fn(),
    setSkillEnabled: vi.fn(),
    previewUpload: vi.fn(),
    confirmUpload: vi.fn(),
    listMcpServers: vi.fn().mockResolvedValue([OFFICIAL, OWN]),
    registerMcpServer: vi.fn().mockResolvedValue(OWN),
    setMcpEnabled: vi.fn().mockResolvedValue(undefined),
    deleteMcpServer: vi.fn().mockResolvedValue(undefined),
    listMcpSecrets: vi.fn().mockResolvedValue([SECRET]),
    createMcpSecret: vi.fn().mockResolvedValue("srt_000000000000000000000000000000ff"),
    deleteMcpSecret: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function renderPanel(client: HubClient, onClose = vi.fn()) {
  return render(<McpPanel client={client} onClose={onClose} />, { wrapper: LocaleProvider })
}

function openRegister(nameValue: string, urlValue: string) {
  fireEvent.click(screen.getByText("Register connection"))
  fireEvent.change(screen.getByPlaceholderText("e.g. my-search"), { target: { value: nameValue } })
  fireEvent.change(screen.getByPlaceholderText("https://…"), { target: { value: urlValue } })
}

afterEach(cleanup)

describe("McpPanel", () => {
  it("renders the server pool with official (read-only) and own (actionable)", async () => {
    renderPanel(makeClient())
    await screen.findByText("official-search")
    expect(screen.getByText("my-tools")).toBeTruthy()
    expect(screen.getByText("Official")).toBeTruthy()
    expect(screen.getByText("Own")).toBeTruthy()
    // official 只读：无启停/删除按钮；自有项两枚动作按钮都在（各恰一枚）。
    expect(screen.getByText("Disable")).toBeTruthy()
    expect(screen.getByText("Delete")).toBeTruthy()
    // 两条都 enabled → 两枚 Enabled 徽标。
    expect(screen.getAllByText("Enabled").length).toBe(2)
  })

  it("toggles an own server and refetches", async () => {
    const client = makeClient()
    renderPanel(client)
    await screen.findByText("my-tools")
    fireEvent.click(screen.getByText("Disable"))
    await waitFor(() => expect(client.setMcpEnabled).toHaveBeenCalledWith("my-tools", false))
    await waitFor(() => expect((client.listMcpServers as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2))
  })

  it("deletes an own server and refetches", async () => {
    const client = makeClient()
    renderPanel(client)
    await screen.findByText("my-tools")
    fireEvent.click(screen.getByText("Delete"))
    await waitFor(() => expect(client.deleteMcpServer).toHaveBeenCalledWith("my-tools"))
    await waitFor(() => expect((client.listMcpServers as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2))
  })

  it("registers a server with an existing secret handle", async () => {
    const client = makeClient()
    renderPanel(client)
    await screen.findByText("my-tools")
    openRegister("new-server", "https://new.example.com/mcp")
    fireEvent.change(screen.getByLabelText("Credential"), {
      target: { value: "srt_00000000000000000000000000000001" },
    })
    fireEvent.click(screen.getByText("Register"))
    await waitFor(() =>
      expect(client.registerMcpServer).toHaveBeenCalledWith({
        name: "new-server",
        transport: "streamable_http",
        url: "https://new.example.com/mcp",
        allowed_tools: [],
        secret_ref: "handle:srt_00000000000000000000000000000001",
      }),
    )
  })

  it("creates a new secret inline then registers with its handle", async () => {
    const client = makeClient()
    renderPanel(client)
    await screen.findByText("my-tools")
    openRegister("svc", "https://svc.example.com/mcp")
    fireEvent.change(screen.getByLabelText("Credential"), { target: { value: "new" } })
    fireEvent.change(screen.getByPlaceholderText("e.g. search-api-key"), { target: { value: "svc-key" } })
    fireEvent.change(screen.getByPlaceholderText("Paste a token or key"), { target: { value: "super-secret" } })
    fireEvent.click(screen.getByText("Register"))
    await waitFor(() => expect(client.createMcpSecret).toHaveBeenCalledWith("svc-key", "super-secret"))
    await waitFor(() =>
      expect(client.registerMcpServer).toHaveBeenCalledWith(
        expect.objectContaining({ secret_ref: "handle:srt_000000000000000000000000000000ff" }),
      ),
    )
  })

  it("humanizes a private-url rejection on register", async () => {
    const client = makeClient({
      registerMcpServer: vi
        .fn()
        .mockRejectedValue(new HubClientError("http", "forbidden", "hub.mcp_url_forbidden", 400)),
    })
    renderPanel(client)
    await screen.findByText("my-tools")
    openRegister("bad", "http://10.0.0.1/mcp")
    fireEvent.click(screen.getByText("Register"))
    await screen.findByText(
      "URL didn't pass validation: it must be https, not private, and must not embed credentials.",
    )
  })

  it("humanizes the mutation-disabled gate on register", async () => {
    const client = makeClient({
      registerMcpServer: vi
        .fn()
        .mockRejectedValue(new HubClientError("http", "disabled", "capability_registration_disabled", 503)),
    })
    renderPanel(client)
    await screen.findByText("my-tools")
    openRegister("x", "https://x.example.com/mcp")
    fireEvent.click(screen.getByText("Register"))
    await screen.findByText("MCP connection registration isn't available yet.")
  })

  it("creates a secret in the secrets tab", async () => {
    const client = makeClient()
    renderPanel(client)
    await screen.findByText("my-tools")
    fireEvent.click(screen.getByRole("tab", { name: "Credentials" }))
    await screen.findByText("search-key")
    fireEvent.change(screen.getByPlaceholderText("e.g. search-api-key"), { target: { value: "another" } })
    fireEvent.change(screen.getByPlaceholderText("Paste a token or key"), { target: { value: "val" } })
    fireEvent.click(screen.getByText("Save credential"))
    await waitFor(() => expect(client.createMcpSecret).toHaveBeenCalledWith("another", "val"))
  })

  it("deletes a secret and refetches", async () => {
    const client = makeClient()
    renderPanel(client)
    await screen.findByText("my-tools")
    fireEvent.click(screen.getByRole("tab", { name: "Credentials" }))
    await screen.findByText("search-key")
    fireEvent.click(screen.getByText("Delete"))
    await waitFor(() => expect(client.deleteMcpSecret).toHaveBeenCalledWith(SECRET.handle))
  })
})
