export type ChatProductCopy = Readonly<{
  workspaceLabel: string
  newChat: string
  creatingChat: string
  startTitle: string
  startDescription: string
  unavailable: string
  account: string
  conversation: string
  loading: string
  notFound: string
  emptyTitle: string
  emptyDescription: string
  you: string
  assistant: string
  model: string
  effort: string
  noModel: string
  modelRequired: string
  messageLabel: string
  messagePlaceholder: string
  activeRunPlaceholder: string
  draftWhileRunning: string
  send: string
  sending: string
  attachFiles: string
  uploadingFile: string
  attachmentReady: string
  retryUpload: string
  removeAttachment: string
  attachmentFailed: string
  stop: string
  copy: string
  copied: string
  downloadCode: string
  edit: string
  saveEdit: string
  cancelEdit: string
  regenerate: string
  forkBranch: string
  branch: string
  switchBranch: string
  currentBranch: string
  showEarlierMessages: string
  jumpToLatest: string
  openChatNavigation: string
  closeChatNavigation: string
  reasoning: string
  sources: string
  plan: string
  approve: string
  reject: string
  respond: string
  submitEdit: string
  unsupportedInteraction: string
  invalidNumber: string
  planProgress: string
  subagent: string
  mediaOperation: string
  mediaProgress: string
  definition: string
  definitionRevision: string
  ownerVersion: string
  candidates: string
  costProjection: string
  outcome: string
  finalArtifact: string
  artifact: string
  artifactVersion: string
  mediaClass: string
  imageDetails: string
  byteSize: string
  toolError: string
  toolResultTruncated: string
  cost: string
  freshness: string
  correction: string
  pending: string
  lastUpdated: string
  unsupportedPart: string
  repairRequired: string
  refreshConversation: string
  searchChats: string
  search: string
  allChats: string
  pinned: string
  archived: string
  trash: string
  folders: string
  chats: string
  noChats: string
  newFolder: string
  add: string
  loadMore: string
  renameChat: string
  archiveChat: string
  trashChat: string
  restoreChat: string
  confirmTrash: string
  connectionIdle: string
  connectionConnecting: string
  connectionLive: string
  connectionReconnecting: string
  connectionClosed: string
  connectionAuthRequired: string
  connectionDraining: string
  connectionRepairRequired: string
  connectionUpgradeRequired: string
  runLaunching: string
  runRunning: string
  runPaused: string
  runCancelling: string
  runUnknown: string
  runIdle: string
}>

export const DEFAULT_CHAT_COPY: ChatProductCopy = Object.freeze({
  workspaceLabel: "AI workspace",
  newChat: "New chat",
  creatingChat: "Creating…",
  startTitle: "What would you like to work on?",
  startDescription: "Start with a question or open one of your recent conversations.",
  unavailable: "Chat is unavailable for this account right now.",
  account: "Account",
  conversation: "Conversation",
  loading: "Loading your conversation…",
  notFound: "This conversation is unavailable.",
  emptyTitle: "Start anywhere",
  emptyDescription: "Ask a question, draft something, or work through a problem step by step.",
  you: "You",
  assistant: "Assistant",
  model: "Model",
  effort: "Effort",
  noModel: "No available model",
  modelRequired: "Choose an available model before sending.",
  messageLabel: "Message",
  messagePlaceholder: "Ask anything…",
  activeRunPlaceholder: "Draft your next message while this response finishes…",
  draftWhileRunning: "Saved as a draft for the next turn. This will not interrupt the current response.",
  send: "Send",
  sending: "Sending…",
  attachFiles: "Attach files",
  uploadingFile: "Uploading…",
  attachmentReady: "Ready",
  retryUpload: "Retry",
  removeAttachment: "Remove",
  attachmentFailed: "Upload failed",
  stop: "Stop",
  copy: "Copy",
  copied: "Copied",
  downloadCode: "Download",
  edit: "Edit",
  saveEdit: "Save and send",
  cancelEdit: "Cancel",
  regenerate: "Try again",
  forkBranch: "New branch",
  branch: "Branch",
  switchBranch: "Switch branch",
  currentBranch: "Current",
  showEarlierMessages: "Show earlier messages",
  jumpToLatest: "New response · Jump to latest",
  openChatNavigation: "Open chat navigation",
  closeChatNavigation: "Close chat navigation",
  reasoning: "Reasoning summary",
  sources: "Sources",
  plan: "Plan",
  approve: "Approve",
  reject: "Reject",
  respond: "Respond",
  submitEdit: "Submit edit",
  unsupportedInteraction: "This request needs a newer client before it can be answered safely.",
  invalidNumber: "Enter a valid number before responding.",
  planProgress: "Plan progress",
  subagent: "Subagent",
  mediaOperation: "Media operation",
  mediaProgress: "Media operation progress",
  definition: "Definition",
  definitionRevision: "Definition revision",
  ownerVersion: "Owner version",
  candidates: "Candidates",
  costProjection: "Cost projection",
  outcome: "Outcome",
  finalArtifact: "Final artifact",
  artifact: "Artifact",
  artifactVersion: "Version",
  mediaClass: "Media class",
  imageDetails: "Image details",
  byteSize: "Byte size",
  toolError: "Tool error",
  toolResultTruncated: "Result preview truncated",
  cost: "Cost",
  freshness: "Freshness",
  correction: "Corrects owner version",
  pending: "Pending",
  lastUpdated: "Updated",
  unsupportedPart: "This content needs a newer client.",
  repairRequired: "Refreshing the durable conversation state…",
  refreshConversation: "Refresh conversation",
  searchChats: "Search chats",
  search: "Search",
  allChats: "All chats",
  pinned: "Pinned",
  archived: "Archived",
  trash: "Trash",
  folders: "Folders",
  chats: "Chats",
  noChats: "No chats in this view.",
  newFolder: "New folder",
  add: "Add",
  loadMore: "Load more",
  renameChat: "Rename",
  archiveChat: "Archive",
  trashChat: "Move to trash",
  restoreChat: "Restore",
  confirmTrash: "Move this chat to trash?",
  connectionIdle: "Ready",
  connectionConnecting: "Connecting",
  connectionLive: "Live",
  connectionReconnecting: "Reconnecting",
  connectionClosed: "Offline",
  connectionAuthRequired: "Sign in required",
  connectionDraining: "Reconnecting shortly",
  connectionRepairRequired: "Refreshing state",
  connectionUpgradeRequired: "Update required",
  runLaunching: "Preparing response",
  runRunning: "Working",
  runPaused: "Waiting for you",
  runCancelling: "Stopping",
  runUnknown: "Confirming outcome",
  runIdle: "Ready",
})

export function resolveChatCopy(copy?: Partial<ChatProductCopy>): ChatProductCopy {
  return Object.freeze({ ...DEFAULT_CHAT_COPY, ...copy })
}
