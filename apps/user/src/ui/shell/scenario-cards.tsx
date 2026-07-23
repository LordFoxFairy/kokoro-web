"use client"

// 登录后引导：场景卡网格。点一张即把起步提示填入 composer 并聚焦——普通用户「进来就会用」。
// 场景 = preset/技能地基的场景化包装，无新后端；提示为起步模板，用户可继续编辑。
import { useT } from "@/i18n/context"
import type { MessageKey } from "@/i18n/messages"

import styles from "./scenario-cards.module.css"

type Scenario = {
  key: string
  icon: string
  accent: string
  title: MessageKey
  desc: MessageKey
  prompt: MessageKey
}

const SCENARIOS: readonly Scenario[] = [
  { key: "write", icon: "✍️", accent: "blue", title: "scenario.writeTitle", desc: "scenario.writeDesc", prompt: "scenario.writePrompt" },
  { key: "research", icon: "🔍", accent: "violet", title: "scenario.researchTitle", desc: "scenario.researchDesc", prompt: "scenario.researchPrompt" },
  { key: "data", icon: "📊", accent: "green", title: "scenario.dataTitle", desc: "scenario.dataDesc", prompt: "scenario.dataPrompt" },
  { key: "plan", icon: "🗺️", accent: "amber", title: "scenario.planTitle", desc: "scenario.planDesc", prompt: "scenario.planPrompt" },
  { key: "code", icon: "⚙️", accent: "cyan", title: "scenario.codeTitle", desc: "scenario.codeDesc", prompt: "scenario.codePrompt" },
  { key: "summary", icon: "📝", accent: "pink", title: "scenario.summaryTitle", desc: "scenario.summaryDesc", prompt: "scenario.summaryPrompt" },
]

export function ScenarioCards({ onPick }: { onPick: (prompt: string) => void }) {
  const t = useT()
  return (
    <div className={styles.grid} role="list">
      {SCENARIOS.map((scenario) => (
        <button
          key={scenario.key}
          type="button"
          role="listitem"
          className={styles.card}
          data-accent={scenario.accent}
          onClick={() => onPick(t(scenario.prompt))}
          data-testid={`scenario-${scenario.key}`}
        >
          <span className={styles.icon} aria-hidden>
            {scenario.icon}
          </span>
          <span className={styles.text}>
            <span className={styles.title}>{t(scenario.title)}</span>
            <span className={styles.desc}>{t(scenario.desc)}</span>
          </span>
          <span className={styles.arrow} aria-hidden>
            →
          </span>
        </button>
      ))}
    </div>
  )
}
