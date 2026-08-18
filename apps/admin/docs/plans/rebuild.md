# Admin 重建计划

状态：执行中。

## 阶段 1：完整上游基线

- [x] 删除旧 Admin。
- [x] 完整导入 `shadcn-admin@e16c87f` 的 272 个文件。
- [x] 保留 MIT 许可证。
- [x] 通过原版 Lint、130 个测试和 production build。
- [ ] 增加上游文件 manifest 与差异分类门禁。
- [ ] 提交并推送完整上游基线。

## 阶段 2：框架适配

- [ ] 保持现有视觉、布局、组件和 feature 结构。
- [ ] 增加 Next.js 16 App Router 运行入口。
- [ ] 将 TanStack Router 路由逐页映射到 `src/app`，不重写 feature 组件。
- [ ] 接入 Auth.js，替换 Clerk 与演示认证状态。
- [ ] 保证 Sidebar、Header、搜索、主题、DataTable、Dialog、Sheet 和响应式行为与上游一致。
- [ ] 模板页面源码保留；没有真实业务的页面从生产导航移除。

## 阶段 3：前端契约

- [ ] 定义版本化 Admin API interface、错误码、能力、游标和 view model。
- [ ] 建立契约 fixture adapter，覆盖正常、空、错误、禁止和冲突状态。
- [ ] 浏览器不导入 IAM transport、内部凭证或生成的服务端客户端。
- [ ] IAM 保持不动，缺失契约只记录，不在前端补业务规则。

## 阶段 4：业务产品化

- [ ] Dashboard 接入权威摘要。
- [ ] Users feature 改为真实用户管理。
- [ ] Organizations、Sites 和 Members 使用同一成熟列表/详情/表单模式。
- [ ] Roles 与 Permissions 使用统一主从工作台。
- [ ] Sessions、Access Inspector 和 Audit 使用上游表格与详情模式。
- [ ] 每个 feature 完成后立即删除对应 Demo 数据分支，不保留双实现。

## 阶段 5：真实联调与验收

- [ ] 导入 accepted generated ConnectRPC provider。
- [ ] fixture 与 RPC adapter 运行相同契约测试。
- [ ] 完成单元、组件、契约、权限、类型、Lint 和 production build。
- [ ] 完成性能、响应式、可访问性与首屏无闪动检查。
- [ ] 在可见内置浏览器执行两轮 fresh fixture 全业务 E2E。
- [ ] 输出截图、RPC、SQL、审计、日志和时间证据齐全的分类报告。
- [ ] 所有项目通过后才标记 `ACCEPTED`。
