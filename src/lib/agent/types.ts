export type StopReason =
  "done" | "step_limit" | "budget" | "error" | "needs_user_input";
export type AgentEvent =
  | { type: "plan"; text: string }
  | { type: "tool_call"; stepId: string; name: string; input: string }
  | {
      type: "tool_result";
      stepId: string;
      name: string;
      output: string;
      failed: boolean;
      sources: string[];
    }
  | { type: "message_delta"; text: string }
  | { type: "final"; reason: StopReason; tokens: number; cost: number }
  | { type: "error"; error: string };
export type Call = { id: string; name: string; input: unknown };
export type Turn = { role: "user" | "assistant"; content: string };
export type Round = {
  text: string;
  calls: Call[];
  inputTokens: number;
  outputTokens: number;
  incomplete?: boolean;
};
export type ModelSession = {
  snapshot?: () => string;
  size: () => number;
  next: (
    maxOutput: number,
    signal: AbortSignal,
    delta: (text: string) => void,
  ) => Promise<Round>;
  observe: (call: Call, output: string) => void;
};
export type Limits = {
  steps: number;
  milliseconds: number;
  tokens: number;
  context: number;
  cost: number;
  inputRate: number;
  outputRate: number;
  searchCost: number;
};
export type StoredStep = {
  id: string;
  name: string;
  input: string;
  output: string;
  failed: boolean;
  sources: string[];
};

export type RunState = {
  tokens: number;
  cost: number;
  steps: number;
  rounds: number;
  tainted: boolean;
  sources: string[];
};
export type Checkpoint = RunState & {
  call: Call;
  stepId: string;
  session: string;
  limits: Limits;
};
