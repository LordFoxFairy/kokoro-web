// 起始模板 chips：空首屏的创作入口。点击把一句可续写的起始 prompt 预填进输入框，
// 而非跳转——kokoro-web 暂无创作画布流。模板取自原型 variant-a-mi-mu 的 .chip--template 行。
// 后续可由模型管理平台的 business_type 目录驱动（见 provider/gateway 方向备忘）。

type StarterTemplate = {
  emoji: string
  label: string
  prompt: string
}

const STARTER_TEMPLATES: StarterTemplate[] = [
  { emoji: "📝", label: "学习课件", prompt: "帮我做一份学习课件，讲清楚" },
  { emoji: "💌", label: "写一封信", prompt: "帮我写一封信，写给" },
  { emoji: "💡", label: "想法可视化", prompt: "帮我把这个想法可视化：" },
]

type StarterChipsProps = {
  onPick: (prompt: string) => void
}

export function StarterChips({ onPick }: StarterChipsProps) {
  return (
    <div className="kk-starter" role="group" aria-label="创作模板">
      {STARTER_TEMPLATES.map((template) => (
        <button
          key={template.label}
          className="kk-starter__chip"
          type="button"
          onClick={() => onPick(template.prompt)}
        >
          <span className="kk-starter__emoji" aria-hidden>
            {template.emoji}
          </span>
          <span>{template.label}</span>
        </button>
      ))}
    </div>
  )
}
