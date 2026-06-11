// 输入上限：发起网络/模拟前拦截超长草稿；同步作为 textarea maxLength 双重把关。
export const MAX_INPUT_LENGTH = 4000

// 自适应高度：归零再贴合 scrollHeight（CSS max-height 硬顶）；jsdom 下 scrollHeight 恒 0 仍不抛错。
export function resizeComposer(node: HTMLTextAreaElement) {
  node.style.height = "auto"
  node.style.height = `${node.scrollHeight}px`
}
