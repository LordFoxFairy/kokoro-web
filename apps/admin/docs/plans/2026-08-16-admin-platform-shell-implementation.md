# Kokoro Admin Platform Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 IAM 运营控制台改造成默认浅色的 Kokoro 整体管理后台壳层，同时保持所有 IAM 业务逻辑、ConnectRPC 和 Auth.js 行为不变。

**Architecture:** `apps/admin/modules/registry.ts` 拥有平台模块描述和可执行导航，IAM registry 只提供当前模块。界面直接采用 Ant Design Pro 的 `ProLayout`、`PageContainer`、`ProTable`、`QueryFilter/ProForm`、`ModalForm` 和 `ProDescriptions`；Kokoro 只维护薄 wrapper、语义 token 和业务动作。自动化浏览器回归默认 headless，最终可见验收由 Codex 内置浏览器完成。

**Tech Stack:** Next.js 16.2.6, React 19.2.4, TypeScript 5.9.3, Ant Design 6.5.0, Pro Components 2.8.10, Vitest 4.1.10, Playwright 1.51.1, Auth.js 5 beta, ConnectRPC 2.1.2.

## Global Constraints

- 当前只注册 6 个真实可用入口，不创建占位菜单或空壳页面。
- 删除产品级“运营”“Operations Console”“IAM Operations Console”文案，不保留兼容别名。
- 固定浅色主题；不读取系统暗色偏好，不新增主题切换。
- 不改变 IAM RPC、数据库、软删除、幂等、权限、Auth.js 或 Env URL 边界。
- 不处理 TLS、网关、部署或运维拓扑。
- 最终可见验收使用 Codex 内置浏览器。

---

### Task 1: Product Copy And Registry Contract

**Files:**
- Create: `apps/admin/test/contract/platform-shell.test.ts`
- Modify: `apps/admin/i18n/messages.ts`
- Modify: `apps/admin/i18n/en.ts`
- Modify: `apps/admin/app/layout.tsx`
- Modify: `apps/admin/test/contract/i18n-completeness.test.ts`

**Interfaces:**
- Consumes: `MessageKey`, `zh`, `en`, Next.js `Metadata`.
- Produces: platform-level copy keys and a contract that rejects old operations-console positioning.

- [ ] **Step 1: Write the failing platform-copy contract**

```ts
it("WEB-CONTRACT-SHELL-001 identifies the product as Kokoro Admin", () => {
  expect(zh["app.product"]).toBe("管理后台");
  expect(zh["auth.login.title"]).toBe("登录管理后台");
  expect(en["app.product"]).toBe("Admin Console");
  expect(JSON.stringify({ zh, en })).not.toMatch(/运营控制台|运营后台登录|Operations Console|IAM Operations Console/u);
});
```

- [ ] **Step 2: Run the contract and verify RED**

Run: `pnpm --filter @kokoro/admin-web exec vitest run test/contract/platform-shell.test.ts`

Expected: FAIL on existing IAM operations copy.

- [ ] **Step 3: Replace product-level copy and metadata**

Set `app.product`, login title/description, overview title and navigation group copy to platform language. Keep IAM names only inside IAM service and module descriptions.

- [ ] **Step 4: Run copy and i18n contracts**

Run: `pnpm --filter @kokoro/admin-web exec vitest run test/contract/platform-shell.test.ts test/contract/i18n-completeness.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/app/layout.tsx apps/admin/i18n apps/admin/test/contract
git commit -m "feat(admin): establish platform product identity"
```

### Task 2: Platform-Owned Module Registry

**Files:**
- Create: `apps/admin/modules/registry.ts`
- Create: `apps/admin/modules/INDEX.md`
- Modify: `apps/admin/modules/iam/registry.ts`
- Modify: `apps/admin/components/shell/navigation.ts`
- Modify: `apps/admin/INDEX.md`
- Test: `apps/admin/test/contract/platform-shell.test.ts`

**Interfaces:**
- Consumes: IAM executable descriptors and `MessageKey`.
- Produces: `AdminModuleDescriptor`, `adminModuleRegistry`, and sorted `adminNavigation`.

- [ ] **Step 1: Add failing registry assertions**

```ts
expect(adminModuleRegistry.map((item) => item.href)).toEqual([
  "/", "/users", "/sessions", "/organizations", "/access", "/audit",
]);
expect(adminModuleRegistry.every((item) => item.executable)).toBe(true);
expect(new Set(adminModuleRegistry.map((item) => item.key)).size).toBe(6);
```

- [ ] **Step 2: Run registry contract and verify RED**

Run: `pnpm --filter @kokoro/admin-web exec vitest run test/contract/platform-shell.test.ts`

- [ ] **Step 3: Implement platform registry**

```ts
export type AdminModuleDescriptor = Readonly<{
  key: string;
  href: string;
  labelKey: MessageKey;
  groupKey: MessageKey | null;
  iconKey: AdminIconKey;
  order: number;
  executable: true;
}>;

export const adminModuleRegistry = Object.freeze(
  [...iamModuleRegistry].sort((left, right) => left.order - right.order),
);
```

- [ ] **Step 4: Update navigation projection and INDEX files**

`navigation.ts` imports only `adminModuleRegistry`; global shell files no longer import IAM registry directly.

- [ ] **Step 5: Run contract, typecheck and lint**

Run: `pnpm --filter @kokoro/admin-web exec vitest run test/contract/platform-shell.test.ts`

Run: `pnpm --filter @kokoro/admin-web typecheck`

Run: `pnpm --filter @kokoro/admin-web lint --max-warnings=0`

- [ ] **Step 6: Commit**

```bash
git add apps/admin/modules apps/admin/components/shell/navigation.ts apps/admin/INDEX.md apps/admin/test/contract/platform-shell.test.ts
git commit -m "refactor(admin): separate platform and IAM registries"
```

### Task 3: Ant Design Pro Light Shell

**Files:**
- Modify: `apps/admin/lib/theme.ts`
- Modify: `apps/admin/components/shell/admin-shell.tsx`
- Create: `apps/admin/components/platform/admin-page.tsx`
- Modify: `apps/admin/app/globals.css`
- Modify: `apps/admin/test/component/admin-shell.test.tsx`
- Modify: `apps/admin/test/component/login.test.tsx`
- Test: `apps/admin/test/contract/platform-shell.test.ts`

**Interfaces:**
- Consumes: `adminNavigation`, `SafeAdministrator`, `antdTheme`, `proLayoutToken`.
- Produces: light sidebar/header/workspace, platform brand block, grouped current navigation and responsive collapse.

- [ ] **Step 1: Write failing theme and shell tests**

```ts
expect(proLayoutToken.sider.colorMenuBackground).toBe("#ffffff");
expect(proLayoutToken.sider.colorBgMenuItemSelected).toBe("#e6f4ff");
expect(screen.getByText("管理后台")).toBeVisible();
expect(screen.getByRole("navigation", { name: "主导航" })).toBeVisible();
```

- [ ] **Step 2: Run component contracts and verify RED**

Run: `pnpm --filter @kokoro/admin-web exec vitest run test/component/admin-shell.test.tsx test/component/login.test.tsx test/contract/platform-shell.test.ts`

- [ ] **Step 3: Replace theme tokens**

Use Ant Design's default light algorithm and the exact semantic palette from `admin-platform-shell-technical-design.md`. Remove dark rail tokens; do not duplicate component CSS already owned by Ant Design Pro.

- [ ] **Step 4: Implement the light ProLayout shell**

Keep `ProLayout`, icon buttons and language selector. Render product identity as `Kokoro` plus localized `app.product`; use grouped navigation and a white header with a 1px border.

- [ ] **Step 5: Refine global CSS**

Set the sidebar, header, workspace, filters and tables to light surfaces. Limit card radius to 8px. Preserve table-local horizontal scrolling and visible keyboard focus.

- [ ] **Step 6: Run component tests**

Run: `pnpm --filter @kokoro/admin-web test:component`

Expected: all component cases PASS, no skipped tests.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/lib/theme.ts apps/admin/components/shell/admin-shell.tsx apps/admin/app/globals.css apps/admin/test/component
git commit -m "feat(admin): apply light management shell"
```

### Task 4: ProTable, QueryFilter And ProDescriptions Migration

**Files:**
- Create: `apps/admin/components/data/admin-table.tsx`
- Create: `apps/admin/components/forms/admin-query-filter.tsx`
- Modify: `apps/admin/modules/iam/users/user-table.tsx`
- Modify: `apps/admin/modules/iam/sessions/session-table.tsx`
- Modify: `apps/admin/modules/iam/organizations/organization-table.tsx`
- Modify: `apps/admin/modules/iam/organizations/organization-detail.tsx`
- Modify: `apps/admin/modules/iam/members/member-table.tsx`
- Modify: `apps/admin/modules/iam/access/access-catalog.tsx`
- Modify: `apps/admin/modules/iam/audit/event-table.tsx`
- Modify: `apps/admin/app/globals.css`
- Modify: `apps/admin/test/component/admin-shell.test.tsx`
- Modify: `apps/admin/test/component/users.test.tsx`
- Modify: `apps/admin/test/component/organizations.test.tsx`
- Modify: `apps/admin/test/pair/audit-idempotency.spec.ts`

**Interfaces:**
- Consumes: existing validated view models, Server Actions and URL builders.
- Produces: shared ProTable density/toolbar behavior, ProForm-based URL filters, ModalForm commands and ProDescriptions details.

- [ ] **Step 1: Add failing standard-component assertions**

Assert list pages render ProTable/QueryFilter semantics, detail pages render ProDescriptions, and business action controls remain reachable.

- [ ] **Step 2: Run targeted component tests and verify RED**

Run: `pnpm --filter @kokoro/admin-web exec vitest run test/component/admin-shell.test.tsx test/component/users.test.tsx test/component/organizations.test.tsx`

- [ ] **Step 3: Implement thin shared wrappers**

`AdminTable` fixes `size="small"`, disables unneeded default tools, preserves server-owned pagination, and keeps row actions. `AdminQueryFilter` maps ProForm values into existing URL query builders without fetching data in the browser.

- [ ] **Step 4: Migrate IAM screens**

Replace repeated Ant `Table`, native filter forms and `Descriptions` with Pro Components while preserving every existing action callback and view model.

- [ ] **Step 5: Run component and accessibility gates**

Run: `pnpm --filter @kokoro/admin-web test:component`

Run: `pnpm --filter @kokoro/admin-web test:security`

- [ ] **Step 6: Commit**

```bash
git add apps/admin/components apps/admin/modules/iam apps/admin/app/globals.css apps/admin/test/component
git commit -m "refactor(admin): standardize IAM screens on Pro Components"
```

### Task 5: Responsive And Accessibility Closure

**Files:**
- Modify: `apps/admin/app/globals.css`
- Modify: `apps/admin/test/component/admin-shell.test.tsx`
- Modify: `apps/admin/test/component/users.test.tsx`
- Modify: `apps/admin/test/component/organizations.test.tsx`
- Modify: `apps/admin/test/pair/audit-idempotency.spec.ts`

- [ ] Add 360px tests for shell collapse, QueryFilter one-column layout, ProTable region overflow and visible page commands.
- [ ] Implement only the layout constraints not already owned by Pro Components.
- [ ] Run component/security tests, typecheck and lint.
- [ ] Commit with `fix(admin): close responsive Pro shell states`.

### Task 6: Browser Harness Correction

**Files:**
- Modify: `apps/admin/playwright.config.ts`
- Modify: `apps/admin/scripts/test/run-pair-acceptance.ts`
- Modify: `apps/admin/test/pair/fixture.test.ts`
- Modify: `apps/admin/test/pair/evidence.test.ts`
- Modify: `apps/admin/test/README.md`
- Modify: `apps/admin/docs/architecture/iam-control-plane-technical-design.md`

**Interfaces:**
- Consumes: existing Pair service supervision and evidence helpers.
- Produces: headless automated regression plus an exact service-only mode for Codex in-app browser validation.

- [ ] **Step 1: Add failing interrupted-run tests**

Test missing `case.json`, terminated Playwright, exact cleanup and partial failure manifest. The runner must report `FAIL` instead of throwing after cleanup.

- [ ] **Step 2: Run Pair fixture tests and verify RED**

Run: `pnpm --filter @kokoro/admin-web exec vitest run test/pair/evidence.test.ts test/pair/fixture.test.ts`

- [ ] **Step 3: Implement headless regression default**

Set Playwright `headless: true`. Remove the external visible-browser requirement from automated acceptance; keep trace/video/HAR and all business assertions.

- [ ] **Step 4: Implement service-only in-app-browser mode**

Add `--serve-for-codex-browser`. It starts the exact fresh stack, prints only the local Admin URL and evidence root, and waits until an explicit stop signal. Cleanup still runs in `finally`.

- [ ] **Step 5: Handle missing case artifacts**

Case collection filters for directories that contain `case.json`; missing expected cases become explicit failed case entries. No `ENOENT` escapes the round report path.

- [ ] **Step 6: Run Pair unit, type and lint gates**

Run: `pnpm --filter @kokoro/admin-web exec vitest run test/pair/evidence.test.ts test/pair/fixture.test.ts`

Run: `pnpm --filter @kokoro/admin-web typecheck`

Run: `pnpm --filter @kokoro/admin-web lint --max-warnings=0`

- [ ] **Step 7: Commit**

```bash
git add apps/admin/playwright.config.ts apps/admin/scripts/test/run-pair-acceptance.ts apps/admin/test apps/admin/docs/architecture/iam-control-plane-technical-design.md
git commit -m "test(admin): support Codex browser acceptance"
```

### Task 7: Repository And Codex In-App Browser Acceptance

**Files:**
- Create: `apps/admin/reports/pairs/iam/<run-id>/report.md`
- Create: `apps/admin/reports/pairs/iam/<run-id>/manifest.json`
- Create: `apps/admin/reports/pairs/iam/<run-id>/screenshots/**`
- Create: `apps/admin/reports/pairs/iam/<run-id>/sha256sums.txt`
- Modify: `apps/admin/reports/pairs/iam/README.md`

**Interfaces:**
- Consumes: clean Admin candidate, frozen IAM commit, fresh PostgreSQL, an in-process local SMTP mailbox and Codex in-app browser.
- Produces: classified repository report and visible end-to-end acceptance evidence.

- [ ] **Step 1: Run the full repository gate**

Run: `pnpm --filter @kokoro/admin-web verify`

Expected: unit/component/contract/integration/security, typecheck, lint, build and smoke all PASS.

- [ ] **Step 2: Start the fresh acceptance stack**

Run `acceptance:pair -- --serve-for-codex-browser` with `PAIR_IAM_SOURCE_REPO` and
`PAIR_POSTGRES_OWNER_URL` supplied through Env. The runner owns the ephemeral local mailbox fixture.

- [ ] **Step 3: Execute all business journeys in Codex in-app browser**

Use the in-app browser to sign in with the SQL-bootstrapped administrator password, reload/logout/revoke Session, manage User and Organization lifecycles, manage Member roles/status, prove RBAC allow/deny/cross-organization denial, double-submit idempotency and inspect audit continuity.

- [ ] **Step 4: Capture classified visual evidence**

At each step record local/UTC start/finish, expected/actual, screenshot path and backend evidence references. Capture desktop, tablet and mobile states.

- [ ] **Step 5: Stop the stack and verify cleanup**

Expected: exact Admin/IAM PIDs gone, both local mailbox listeners released, database/role dropped and IAM worktree removed.

- [ ] **Step 6: Inspect and archive**

Inspect every screenshot, verify checksum inventory, ensure retry/skip/todo are zero, and archive only the final passing run.

- [ ] **Step 7: Commit accepted evidence**

```bash
git add apps/admin/reports/pairs/iam
git commit -m "test(admin): accept platform shell browser journey"
```
