export type AgentType = "taxonomy" | "taxonomy-evaluator" | "plan" | "generator" | "merge" | "evaluator";
export type AgentStatus = "pending" | "running" | "completed" | "failed";
export type Implementation = "deterministic" | "llm";

export interface AgentEvent {
  agentId: string;
  agentType: AgentType;
  status: AgentStatus;
  progress: number;
  message: string;
  timestamp: string;
  payload?: unknown;
}

export interface AgentResult<T> {
  agentId: string;
  agentType: AgentType;
  status: "completed" | "failed";
  data: T | null;
  error?: string;
  durationMs: number;
}

export interface SubAgentConfig {
  pipelineId: string;
  skillId: string;
  domainScope: string;
  implementation: Implementation;
}

export interface AgentState {
  agentId: string;
  agentType: AgentType;
  status: AgentStatus;
  progress: number;
  message: string;
  durationMs?: number;
}

export interface PipelineExecution {
  pipelineId: string;
  config: Record<string, unknown>;
  agents: AgentState[];
  result?: unknown;
  startedAt: string;
  completedAt?: string;
}
