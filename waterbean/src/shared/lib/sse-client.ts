const BASE_URL = "/api";

export interface AgentEvent {
  agentId: string;
  agentType: "taxonomy" | "taxonomy-evaluator" | "plan" | "generator" | "merge" | "evaluator";
  status: "pending" | "running" | "completed" | "failed";
  progress: number;
  message: string;
  timestamp: string;
  payload?: unknown;
}

function openEventSource(
  pipelineId: string,
  onEvent: (event: AgentEvent) => void,
  onComplete?: (result: unknown) => void,
  onStreamError?: () => void,
): () => void {
  const es = new EventSource(`${BASE_URL}/pipeline/run/${pipelineId}/events`);
  let finished = false;

  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data) as Record<string, unknown>;

      if (data.type === "pipeline_complete") {
        finished = true;
        onComplete?.(data.result);
        es.close();
        return;
      }

      if (data.type === "connected") {
        return;
      }

      if (typeof data.agentType === "string") {
        onEvent(data as unknown as AgentEvent);
      }
    } catch {
      // ignore
    }
  };

  es.onerror = () => {
    if (finished) return;
    onStreamError?.();
  };

  return () => {
    finished = true;
    es.close();
  };
}

export function subscribeToPipelineEvents(
  pipelineId: string,
  onEvent: (event: AgentEvent) => void,
  onComplete?: (result: unknown) => void,
  onStreamError?: () => void,
): () => void {
  return openEventSource(pipelineId, onEvent, onComplete, onStreamError);
}
