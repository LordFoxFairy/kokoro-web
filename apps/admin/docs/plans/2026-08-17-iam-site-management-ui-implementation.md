# IAM 与 Site 管理界面实施清单

## Gate 1：权威与契约

- [x] 提升完整 Admin UI PRD。
- [x] 提升 UI 技术方案和组件清单。
- [x] 导入已验收 IAM provider commit 与 `site.proto`。
- [x] 生成客户端并通过 provider/hash/drift 测试。

## Gate 2：平台壳层

- [ ] 固定浅色 token、216px 侧栏、56px 顶栏和稳定内容网格。
- [ ] 重构 permission-aware registry 和分组导航。
- [ ] 修正全部图标尺寸、对齐、Tooltip 和选中状态。
- [ ] 完成 1440/1024/390 壳层组件测试。

## Gate 3：Site Vertical Slices

- [x] Site 列表、服务端搜索/状态筛选、分页和完整状态。
- [x] Site 创建、重命名、暂停、恢复、删除和恢复命令。
- [x] Site 详情摘要和概览 Tab。
- [x] Site 成员增改、停用、移除、恢复和最后 Owner 反馈。
- [x] Site 权限检查和权限目录。
- [x] Site 安全事件筛选、统计和详情 Drawer。
- [x] 当前 Site 选择与导航 scope。

## Gate 4：IAM 完整管理

- [ ] 用户、管理员、Session 页面能力和状态闭环。
- [ ] Organization、成员、角色和权限页面分区重构。
- [ ] 登录日志、操作日志未有后端契约时不注册菜单；安全事件完整实现。
- [ ] 统一 command error、loading、empty、403、404、409 和 deleted 状态。

## Gate 5：自动化与视觉

- [ ] component、integration、contract、security、i18n、typecheck、lint、production build。
- [ ] 1440×1000、1024×768、390×844 每页截图审查。
- [ ] 无菜单/Tab/登录切换布局跳动，无重叠、截断和页面级横向滚动。

## Gate 6：可见浏览器验收

- [ ] 启动真实本地 PostgreSQL、IAM、Admin，不使用 Docker。
- [ ] 在 Codex 内置浏览器逐步执行每个业务命令，零跳过。
- [ ] Fresh fixture 第二轮完整复验。
- [ ] Admin 与 IAM 分别归档分类报告、截图和 RPC/SQL/log 证据。
