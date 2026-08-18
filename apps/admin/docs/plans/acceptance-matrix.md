# Admin 验收矩阵

状态：`FROZEN / NOT_READY`

本矩阵把产品页面、业务操作、自动化门禁和最终证据绑定在一起。`Required evidence` 中列出的
证据必须全部存在且断言通过；单独截图、测试数量或构建成功都不能证明业务闭环。

## 1. 状态定义

| 状态 | 定义 |
|---|---|
| `NOT_READY` | 尚未执行、仍有失败、存在缺失证据，或任一 `skip/todo/retry` 不为零 |
| `PASS` | 单个 case 的所有步骤和必需证据均通过 |
| `FAIL` | 行为、权限、数据、审计、日志或证据任一不符合预期 |
| `ACCEPTED` | 两轮完整 E2E 与全部自动化门禁均通过后的唯一整体完成状态 |

执行前所有行默认 `NOT_READY`。不得预填 `PASS`，不得根据开发者自测推断通过。

## 2. 自动化验收矩阵

| ID | 分类 | 验收范围 | 必需证据 | 当前状态 |
|---|---|---|---|---|
| AUTO-UNIT | 单元 | schema、转换、URL 状态、权限投影、Session 映射 | 命令、提交、报告、用例数、0 skip/todo/retry、开始/结束时间 | `NOT_READY` |
| AUTO-COMP | 组件 | 壳层、表格、筛选、表单、Dialog、Sheet、权限和状态组件 | 测试报告、无障碍断言、失败截图、时间 | `NOT_READY` |
| AUTO-CONTRACT | 契约 | 生成类型、运行时校验、错误码、游标、fixture 版本锁定 | 契约版本、生成命令、测试报告、差异扫描 | `NOT_READY` |
| AUTO-AUTHZ | 权限 | menu/route/action/BFF/IAM 五层一致 | 权限矩阵测试、拒绝响应、审计、时间 | `NOT_READY` |
| AUTO-TYPE | 静态 | TypeScript 严格检查 | 命令、退出码、开始/结束时间 | `NOT_READY` |
| AUTO-LINT | 静态 | ESLint，warning 视为失败 | 命令、退出码、warning 数、时间 | `NOT_READY` |
| AUTO-BUILD | 构建 | Next.js production build | 提交、命令、退出码、构建摘要、时间 | `NOT_READY` |
| AUTO-DEPS | 架构 | 无 Ant/ProComponents/Clerk/旧 Admin/Demo 依赖与代码 | lockfile 与源码扫描结果、时间 | `NOT_READY` |
| AUTO-PERF | 性能 | 冷首屏、暖导航、大表格交互、请求瀑布 | 阈值、采样数据、trace、截图、时间 | `NOT_READY` |
| AUTO-FOUC | 视觉 | 首屏样式、字体、图标和刷新稳定性 | 初始 HTML、0ms/稳定帧截图、像素差异结论、时间 | `NOT_READY` |
| AUTO-RESP | 响应式 | desktop/tablet/mobile 布局和操作可达性 | viewport 清单、截图、交互报告、时间 | `NOT_READY` |

## 3. 页面与业务验收矩阵

证据缩写：

- `S`：逐步截图；`R`：RPC 请求/响应摘要；`Q`：SQL 只读断言。
- `A`：审计记录；`L`：服务日志；`T`：带时区开始/结束时间。
- `C`：自动化组件/页面测试；`P`：权限允许与拒绝证据。

所有 mutation 行必须具备 `S/R/Q/A/L/T`。只读页面至少具备 `S/R/T/C`，涉及数据范围时还需
`P/Q`。两轮 E2E 分别提交完整证据，不得跨轮复用。

| Case ID | 页面/链路 | 必须验证的步骤与结果 | Required evidence | Round 1 | Round 2 |
|---|---|---|---|---|---|
| AUTH-001 | 登录 | 账号密码成功、Session 建立、原目标回跳 | S/R/A/L/T/C | `NOT_READY` | `NOT_READY` |
| AUTH-002 | 登录失败 | 错误凭据、禁用用户、统一错误且不泄密 | S/R/A/L/T/C | `NOT_READY` | `NOT_READY` |
| AUTH-003 | 退出/失效 | 退出清理；失效 Session 访问保护路由被拒 | S/R/A/L/T/C/P | `NOT_READY` | `NOT_READY` |
| AUTH-004 | Dev 账号工具 | dev/test 可见并创建；重复冲突；production 不存在 | S/R/Q/A/L/T/C/P | `NOT_READY` | `NOT_READY` |
| SHELL-001 | 应用壳 | 侧栏、Header、面包屑、搜索、主题、用户菜单 | S/T/C | `NOT_READY` | `NOT_READY` |
| SHELL-002 | 权限导航 | 普通用户无入口；深链和命令搜索同样拒绝 | S/R/L/T/C/P | `NOT_READY` | `NOT_READY` |
| SHELL-003 | 响应式 | 侧栏折叠、移动 Sheet、焦点和操作可达 | S/T/C | `NOT_READY` | `NOT_READY` |
| DASH-001 | Dashboard | 权威指标、时间窗口、事件类型、最近审计 | S/R/Q/T/C/P | `NOT_READY` | `NOT_READY` |
| DASH-002 | 指标导航 | 点击指标进入正确页面并保留筛选 | S/R/T/C | `NOT_READY` | `NOT_READY` |
| DASH-003 | 局部失败 | 数据源失败显示错误，缺失值不伪装为零 | S/R/L/T/C | `NOT_READY` | `NOT_READY` |
| USER-001 | 用户列表 | 搜索、筛选、排序、分页、列设置、详情链接 | S/R/Q/T/C/P | `NOT_READY` | `NOT_READY` |
| USER-002 | 创建用户 | 校验、提交、回读、重复冲突 | S/R/Q/A/L/T | `NOT_READY` | `NOT_READY` |
| USER-003 | 用户详情 | 资料、成员、角色、会话、审计 Tab 与深链 | S/R/Q/T/C/P | `NOT_READY` | `NOT_READY` |
| USER-004 | 编辑用户 | 修改资料、回读、并发冲突 | S/R/Q/A/L/T | `NOT_READY` | `NOT_READY` |
| USER-005 | 用户状态 | 禁用、登录拒绝、恢复、登录恢复 | S/R/Q/A/L/T/P | `NOT_READY` | `NOT_READY` |
| USER-006 | 删除/恢复 | 软删除、默认隐藏、包含删除项、恢复冲突 | S/R/Q/A/L/T/P | `NOT_READY` | `NOT_READY` |
| USER-007 | 用户角色 | 分配/移除 Organization 与 Site 角色、幂等冲突 | S/R/Q/A/L/T/P | `NOT_READY` | `NOT_READY` |
| USER-008 | 凭据管理 | 重置能力按契约执行，敏感值不进入 UI/日志 | S/R/Q/A/L/T/P | `NOT_READY` | `NOT_READY` |
| ORG-001 | Organization 列表 | 搜索、状态、分页、详情和范围过滤 | S/R/Q/T/C/P | `NOT_READY` | `NOT_READY` |
| ORG-002 | Organization 生命周期 | 创建、编辑、软删除、恢复、冲突 | S/R/Q/A/L/T/P | `NOT_READY` | `NOT_READY` |
| ORG-003 | Organization 成员 | 添加、状态变更、移除、重复添加 | S/R/Q/A/L/T/P | `NOT_READY` | `NOT_READY` |
| ORG-004 | Organization 角色 | 创建、编辑、授权、删除/恢复、使用成员 | S/R/Q/A/L/T/P | `NOT_READY` | `NOT_READY` |
| ORG-005 | 关系边界 | 删除前置关系、并发变化和 IAM 业务错误展示 | S/R/Q/A/L/T/P | `NOT_READY` | `NOT_READY` |
| SITE-001 | Site 列表 | 搜索、状态、分页、详情和 scope 隔离 | S/R/Q/T/C/P | `NOT_READY` | `NOT_READY` |
| SITE-002 | Site 生命周期 | 创建、编辑、软删除、恢复、冲突 | S/R/Q/A/L/T/P | `NOT_READY` | `NOT_READY` |
| SITE-003 | 所属关系 | Organization 选择与展示完全来自契约 | S/R/Q/T/C/P | `NOT_READY` | `NOT_READY` |
| SITE-004 | Site 成员 | 添加、状态变更、移除、重复添加 | S/R/Q/A/L/T/P | `NOT_READY` | `NOT_READY` |
| SITE-005 | Site 角色 | 创建、编辑、授权、删除/恢复、使用成员 | S/R/Q/A/L/T/P | `NOT_READY` | `NOT_READY` |
| SITE-006 | 多入口隔离 | 用户端只见授权 Site；独立 Admin 按平台能力展示 | S/R/Q/L/T/C/P | `NOT_READY` | `NOT_READY` |
| ROLE-001 | 角色工作台 | scope 搜索/切换、master-detail、空角色创建 | S/R/Q/T/C/P | `NOT_READY` | `NOT_READY` |
| ROLE-002 | 自定义角色 | 创建、编辑、删除、恢复、重复名称冲突 | S/R/Q/A/L/T/P | `NOT_READY` | `NOT_READY` |
| ROLE-003 | 权限树 | 加载、半选、保存、取消、无变更提交 | S/R/Q/A/L/T/C/P | `NOT_READY` | `NOT_READY` |
| ROLE-004 | 保留角色 | 不可变操作禁用且直接 mutation 被拒 | S/R/Q/A/L/T/C/P | `NOT_READY` | `NOT_READY` |
| ROLE-005 | 角色使用情况 | 成员展示、复制标识、用户跳转、游标分页 | S/R/Q/T/C/P | `NOT_READY` | `NOT_READY` |
| ROLE-006 | 权限即时生效 | 菜单、路由、按钮、BFF 与 IAM 结果一致 | S/R/Q/A/L/T/P | `NOT_READY` | `NOT_READY` |
| SESS-001 | 会话列表/详情 | 用户、状态、时间、分页及清晰字段语义 | S/R/Q/T/C/P | `NOT_READY` | `NOT_READY` |
| SESS-002 | 单会话撤销 | 撤销、回读、原会话访问失败、重复撤销 | S/R/Q/A/L/T/P | `NOT_READY` | `NOT_READY` |
| SESS-003 | 用户会话全撤销 | 全部撤销、当前会话处理、列表回读 | S/R/Q/A/L/T/P | `NOT_READY` | `NOT_READY` |
| AUDIT-001 | 审计列表 | 时间、操作者、对象、动作、结果、requestId 筛选 | S/R/Q/T/C/P | `NOT_READY` | `NOT_READY` |
| AUDIT-002 | 审计详情 | Drawer、请求关联、缺失字段和分页 | S/R/Q/T/C/P | `NOT_READY` | `NOT_READY` |
| AUDIT-003 | 审计完整性 | 登录、创建、修改、授权、删除、恢复、撤销可定位 | S/R/Q/A/L/T | `NOT_READY` | `NOT_READY` |
| AUDIT-004 | 审计脱敏 | 密码、Token、Cookie、凭据和堆栈均不展示 | S/R/Q/L/T/C | `NOT_READY` | `NOT_READY` |
| FLOW-001 | 用户闭环 | 登录 -> 创建用户 -> 详情 -> 审计 -> 退出 | S/R/Q/A/L/T | `NOT_READY` | `NOT_READY` |
| FLOW-002 | Organization 闭环 | 创建 -> 成员 -> 角色 -> 权限 -> 授予 -> 使用回读 | S/R/Q/A/L/T/P | `NOT_READY` | `NOT_READY` |
| FLOW-003 | Site 闭环 | 创建 -> 成员 -> 角色 -> 授权 -> 隔离验证 | S/R/Q/A/L/T/P | `NOT_READY` | `NOT_READY` |
| FLOW-004 | 用户状态闭环 | 禁用 -> Session -> 登录拒绝 -> 恢复 -> 登录恢复 | S/R/Q/A/L/T/P | `NOT_READY` | `NOT_READY` |
| FLOW-005 | 会话闭环 | 撤销 -> 访问失败 -> 列表回读 -> 审计 | S/R/Q/A/L/T/P | `NOT_READY` | `NOT_READY` |
| FLOW-006 | 软删除闭环 | 删除 -> 隐藏 -> 查询删除项 -> 恢复 -> 冲突回读 | S/R/Q/A/L/T/P | `NOT_READY` | `NOT_READY` |
| FLOW-007 | 权限降级闭环 | 降权 -> 菜单消失 -> 路由拒绝 -> mutation 拒绝 | S/R/Q/A/L/T/P | `NOT_READY` | `NOT_READY` |
| FLOW-008 | 服务恢复闭环 | IAM unavailable -> 错误 -> 恢复 -> 成功且无重复提交 | S/R/Q/A/L/T | `NOT_READY` | `NOT_READY` |

## 4. 视觉与交互验收矩阵

| ID | Viewport/场景 | 验收要求 | 必需证据 | 当前状态 |
|---|---|---|---|---|
| VIS-001 | Desktop | 高密度布局、表格、Drawer/Dialog、固定尺寸控件无跳动 | 页面清单截图、交互录像或 trace、时间 | `NOT_READY` |
| VIS-002 | Narrow desktop | 侧栏折叠后内容不遮挡，表格操作仍可达 | 页面清单截图、时间 | `NOT_READY` |
| VIS-003 | Tablet | 导航、筛选、详情和表单适配，无横向页面溢出 | 页面清单截图、时间 | `NOT_READY` |
| VIS-004 | Mobile | Sheet 导航、表格替代布局、触控目标和长文本适配 | 页面清单截图、时间 | `NOT_READY` |
| VIS-005 | Refresh | 0ms 与稳定帧样式、字体、图标、尺寸一致 | 双帧截图、首屏 HTML、像素检查、时间 | `NOT_READY` |
| VIS-006 | Navigation | 页面切换即时反馈，无空白停顿和布局闪变 | trace、关键帧截图、耗时、时间 | `NOT_READY` |
| VIS-007 | States | loading/empty/error/forbidden/success 视觉一致 | 各页面状态截图索引、时间 | `NOT_READY` |
| VIS-008 | Accessibility | 键盘、焦点、可访问名称、Dialog 焦点管理 | 自动化报告、人工步骤与截图、时间 | `NOT_READY` |

## 5. 每轮执行元数据

每轮报告头必须包含以下字段，缺一则该轮保持 `NOT_READY`：

| 字段 | Round 1 | Round 2 |
|---|---|---|
| Admin commit | 待执行 | 待执行 |
| API contract version/commit | 待执行 | 待执行 |
| IAM commit | 待执行 | 待执行 |
| Fresh fixture ID | 待执行 | 待执行 |
| Started/finished at | 待执行 | 待执行 |
| Browser/version | 待执行 | 待执行 |
| Viewports | 待执行 | 待执行 |
| Planned/executed/pass/fail | 待执行 | 待执行 |
| skip/todo/retry | 必须为 `0/0/0` | 必须为 `0/0/0` |
| Screenshot index | 待执行 | 待执行 |
| RPC/SQL/audit/log index | 待执行 | 待执行 |
| Overall result | `NOT_READY` | `NOT_READY` |

## 6. 最终接受条件

只有同时满足以下条件，才允许把整体状态从 `NOT_READY` 修改为 `ACCEPTED`：

1. 自动化矩阵全部 `PASS`，并且 type、lint、build、性能、响应式和 FOUC 均有证据。
2. 页面与业务矩阵的 Round 1、Round 2 每一行均为 `PASS`。
3. 两轮均在可见 Codex 内置浏览器中完成，使用不同 fresh fixture。
4. 两轮 `skip = 0`、`todo = 0`、`retry = 0`，计划数等于执行数等于通过数。
5. 每个 mutation 同时具备截图、RPC、SQL、audit、log 和时间证据。
6. 权限允许与拒绝、Site/Organization 隔离、软删除/恢复、会话撤销均完成真实 IAM 验证。
7. 所有缺陷均有修复提交，并对受影响业务链路完成全量重跑。
8. 最终报告中的提交、契约和运行环境可复现，证据索引无断链。

任一条件不成立时，报告必须明确列出缺口，并继续保持 `NOT_READY`。
