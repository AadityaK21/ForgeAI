export type ProviderState = {
  providers: {
    anthropic: boolean;
    openai: boolean;
    local: boolean;
    e2b: boolean;
  };
  provider: string | null;
  modelLabel: string;
  canSaveToServer: boolean;
};
