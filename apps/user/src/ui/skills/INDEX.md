---
architectureIndex: 1
rootId: web.user.ui.skills
owners:
  - "@LordFoxFairy"
---

# ui/skills — 技能面板

## 职责
hub self 面技能池（有效可用项）：列表/启停/配额/版本历史 + 上传 preview→confirm 两段发布。

## 公开件
- `SkillsPanel`（`skills-panel.tsx`）：props `client: HubClient` / `onClose` / `pinned` / `onTogglePin`。

## 协作者
- `@/hub/client`（纯请求）、`@/hub/rules`（`isRequiredLockError` / `isQuotaExhausted`）、`@/hub/schemas`。
- `@/lib/query`：池+配额合并读走 `useResource("hub/skills")`；启停/发布成功后 `invalidate("hub/skills")`。版本历史键 `hub/skill-revisions/<name>`。

## 陷阱
- 池只含「有效可用」项（official 上架∧未关 + 自有包）；池内项恒为已启用，唯一动作是停用。
- required 官方技能拒关：hub 409 `hub.skill_required` → 经 `isRequiredLockError` 反射为锁定态。
- 上传是非缓存状态机（idle→preview→confirming→done），不走 query 层。
