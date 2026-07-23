"use client"

// Composer 模型/agent 选择器 controller（MODEL-UX / AGENT-PRESET）：挂载各取一次候选
// （platform 单源经 session /models、namespace profile 经 /agents），选中即注入引擎——
// 下一次开跑随 messageCreate 上 wire。失败/空候选=空列表（选择器不渲染）；null 选择=用 profile 缺省。

import { useEffect, useState } from "react"

import type { AgentCandidate, ModelCandidate } from "@/contract/http"
import type { SessionEngine } from "@/engine/machine"
import { readChatAgent, readChatModel } from "@/ui/settings/chat-prefs"

import { browserListClient } from "./page-clients"

export type ComposerSelectors = {
  models: readonly ModelCandidate[]
  selectedModel: string | null
  setSelectedModel: (value: string | null) => void
  agents: readonly AgentCandidate[]
  selectedAgent: string | null
  setSelectedAgent: (value: string | null) => void
}

export function useComposerSelectors(engine: SessionEngine | null): ComposerSelectors {
  const [models, setModels] = useState<readonly ModelCandidate[]>([])
  // 选中模型 wire 选择子（"provider:name"）：null=用 profile 缺省，不上 wire。初值取 settings 缺省偏好
  // （WEB-FACE 面三）——新对话首帧预填，开跑后 modeLocked 锁定，会话级锁语义不变。
  const [selectedModel, setSelectedModel] = useState<string | null>(() => readChatModel())
  useEffect(() => {
    let live = true
    void browserListClient()
      .listModels()
      .then((list) => live && setModels(list.models))
      .catch(() => live && setModels([]))
    return () => {
      live = false
    }
  }, [])
  useEffect(() => {
    engine?.setModel(selectedModel)
  }, [engine, selectedModel])

  const [agents, setAgents] = useState<readonly AgentCandidate[]>([])
  // 选中 agent wire 名：null=用 profile 缺省 general，不上 wire。初值取 settings 缺省偏好（面三）。
  const [selectedAgent, setSelectedAgent] = useState<string | null>(() => readChatAgent())
  useEffect(() => {
    let live = true
    void browserListClient()
      .listAgents()
      .then((list) => live && setAgents(list.agents))
      .catch(() => live && setAgents([]))
    return () => {
      live = false
    }
  }, [])
  useEffect(() => {
    engine?.setAgent(selectedAgent)
  }, [engine, selectedAgent])

  return { models, selectedModel, setSelectedModel, agents, selectedAgent, setSelectedAgent }
}
