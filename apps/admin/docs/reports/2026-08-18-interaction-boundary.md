# Admin 交互边界测试报告

## 结论

| 字段 | 结果 |
|---|---|
| 批次 | Detail navigation, dangerous confirmation and fixture scenarios |
| 代码基线 | `38bbba1` + 本批次未提交变更 |
| 执行时间 | 2026-08-18T16:32:56-04:00 至 2026-08-18T16:33:02-04:00 |
| 分类状态 | `PASS` |
| 页面接线状态 | `NOT_READY` |
| Admin 整体状态 | `NOT_READY` |
| Skip / Todo / Retry | `0 / 0 / 0` |

## 自动化结果

| 门禁 | 命令 | 结果 |
|---|---|---|
| 单元测试 | `pnpm test` | PASS；22 files，361 tests |
| TypeScript | `pnpm typecheck` | PASS |
| ESLint | `pnpm exec eslint . --max-warnings=0` | PASS；0 warnings |
| Prettier | `pnpm format:check` | PASS |
| Production build | `pnpm build` | PASS；Next.js 16.2.6 |
| Diff hygiene | `git diff --check` | PASS |

## 本批次覆盖

- 用户、Organization、Site 详情页使用各自显式 Tab 集合与默认 Tab。
- `returnTo` 只接受对应列表路径及严格白名单查询，拒绝外域、协议相对、凭据、fragment、重复参数、
  反斜杠和控制字符。
- Directory URL 原样保存契约 pageToken 与受支持 pageSize，不解析或拼接 token。
- Fixture pageToken 签名绑定 domain、scope、query、filters、sort 与 pageSize，跨查询复用稳定拒绝。
- 危险操作必须提供完整操作上下文，并配置 reason 或精确确认文本之一。
- 危险操作提交期间冻结输入，revision 阻止旧响应覆盖后续状态，失败保留操作员输入。
- Fixture 场景只能经 runtime-branded AdminEnv 与中央 data-source 创建，production 配置无法进入。
- 场景 operation、scenario、partial metadata、取消信号和确定性 requestId 均有运行时边界。

## 独立审查修正

- 禁止 submitting 状态再次编辑并发起第二个危险命令。
- 拒绝空 action/object/impact 及完全无保护的危险确认配置。
- 使用原生 pageToken 取代不可恢复的虚构页码，并接入目录搜索状态。
- 为 pageToken 增加请求签名，拒绝跨筛选、排序、pageSize、scope/domain 复用。
- AdminEnv 增加不可枚举 runtime brand；复制或伪造的普通对象无法创建数据客户端。
- Scenario class 改为模块私有，factory 强制已解析 fixture 环境，operation/scenario 启动期校验。
- Partial guard 严格要求非空、唯一且已知的 missingSections。
- Ready 与注入场景统一处理已取消请求。

## 未验收项

- App Router 页面实际读取 URL 状态并驱动 DataTable/RPC。
- shadcn Dialog、焦点恢复、键盘路径与真实危险 mutation。
- 官方 shadcn/ui Shell、Auth.js、业务页面和组件测试。
- generated ConnectRPC、IAM 联调及两轮可见浏览器 E2E。

本报告只证明共享交互状态与 fixture 场景边界通过，不代表 Admin 页面或业务闭环完成。
