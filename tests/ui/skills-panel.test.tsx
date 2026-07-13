// 技能面板组件测试：池渲染（official/own 徽标）+ 停用成功后离池 + required 撞 409 锁定 +
// 固定回调 + 上传 preview→confirm 两段。hub 客户端为注入 fake（不打网络）。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { HubClientError, type HubClient } from "@/hub/client"
import type { SkillCard } from "@/hub/schemas"
import { LocaleProvider } from "@/i18n/context"
import { SkillsPanel } from "@/ui/skills/skills-panel"

const OFFICIAL: SkillCard = { name: "brainstorming", description: "explore", content_hash: "h1", scope: "official" }
const OWN: SkillCard = { name: "my-skill", description: "mine", content_hash: "h2", scope: "team_1" }

function makeClient(overrides: Partial<HubClient> = {}): HubClient {
  return {
    listSkillPool: vi.fn().mockResolvedValue([OFFICIAL, OWN]),
    skillQuota: vi.fn().mockResolvedValue({
      namespace: "team_1",
      package_count: 1,
      package_bytes: 2048,
      max_packages: 20,
      max_bytes: 10_000_000,
    }),
    skillRevisions: vi.fn().mockResolvedValue([]),
    setSkillEnabled: vi.fn().mockResolvedValue(undefined),
    previewUpload: vi.fn(),
    confirmUpload: vi.fn(),
    listMcpServers: vi.fn().mockResolvedValue([]),
    registerMcpServer: vi.fn(),
    setMcpEnabled: vi.fn().mockResolvedValue(undefined),
    deleteMcpServer: vi.fn().mockResolvedValue(undefined),
    listMcpSecrets: vi.fn().mockResolvedValue([]),
    createMcpSecret: vi.fn(),
    deleteMcpSecret: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function renderPanel(client: HubClient, onTogglePin = vi.fn(), onClose = vi.fn()) {
  return render(<SkillsPanel client={client} onClose={onClose} pinned={[]} onTogglePin={onTogglePin} />, {
    wrapper: LocaleProvider,
  })
}

afterEach(cleanup)

describe("SkillsPanel", () => {
  it("renders the pool with official/own badges and quota", async () => {
    renderPanel(makeClient())
    await screen.findByText("brainstorming")
    expect(screen.getByText("my-skill")).toBeTruthy()
    expect(screen.getByText("Official")).toBeTruthy()
    expect(screen.getByText("Own")).toBeTruthy()
    expect(screen.getByTestId("skills-quota").textContent).toContain("1/20")
  })

  it("disables a skill and refetches the pool", async () => {
    const client = makeClient()
    renderPanel(client)
    await screen.findByText("brainstorming")
    const disableButtons = screen.getAllByText("Disable")
    fireEvent.click(disableButtons[0]!)
    await waitFor(() => expect(client.setSkillEnabled).toHaveBeenCalledWith("brainstorming", false))
    // 停用成功后重取池（初次 + 停用后 = 2 次）。
    await waitFor(() => expect((client.listSkillPool as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2))
  })

  it("locks a required skill when disable hits 409 hub.skill_required", async () => {
    const client = makeClient({
      setSkillEnabled: vi
        .fn()
        .mockRejectedValue(new HubClientError("http", "required", "hub.skill_required", 409)),
    })
    renderPanel(client)
    await screen.findByText("brainstorming")
    fireEvent.click(screen.getAllByText("Disable")[0]!)
    // 撞 409 后出现必备锁定徽标（多处，取任一）。
    await waitFor(() => expect(screen.getAllByText("Required").length).toBeGreaterThan(0))
  })

  it("pins a skill via the callback", async () => {
    const onTogglePin = vi.fn()
    renderPanel(makeClient(), onTogglePin)
    await screen.findByText("brainstorming")
    fireEvent.click(screen.getAllByText("Pin")[0]!)
    expect(onTogglePin).toHaveBeenCalledWith("brainstorming")
  })

  it("runs the upload preview→confirm two-stage flow", async () => {
    const client = makeClient({
      previewUpload: vi.fn().mockResolvedValue({
        namespace: "team_1",
        candidates: [
          {
            name: "fresh",
            valid: true,
            errors: [],
            description: "d",
            content_hash: "h",
            package_size: 10,
            file_count: 1,
            files: [{ path: "SKILL.md", size: 10 }],
            conflicts: { official: false, namespace: false },
          },
        ],
      }),
      confirmUpload: vi.fn().mockResolvedValue({
        namespace: "team_1",
        results: [{ name: "fresh", status: "published", revision: 1, content_hash: "h", error: null }],
      }),
    })
    renderPanel(client)
    fireEvent.click(screen.getByRole("tab", { name: "Upload" }))
    const file = new File(["zip-bytes"], "skills.zip", { type: "application/zip" })
    const input = screen.getByLabelText("Choose a zip file") as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
    await screen.findByText("fresh")
    expect(client.previewUpload).toHaveBeenCalled()
    fireEvent.click(screen.getByText("Publish selected"))
    await waitFor(() => expect(client.confirmUpload).toHaveBeenCalledWith(expect.anything(), ["fresh"]))
    await screen.findByText("Published")
  })
})
