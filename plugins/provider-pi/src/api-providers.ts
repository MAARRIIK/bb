export const PI_API_PROVIDERS = [
  {
    id: "gemini",
    name: "Gemini",
    provider: "google",
    environmentVariable: "GEMINI_API_KEY",
    documentationUrl: "https://ai.google.dev/gemini-api/docs/api-key",
  },
  {
    id: "kimi",
    name: "Kimi / Moonshot AI",
    provider: "moonshotai",
    environmentVariable: "MOONSHOT_API_KEY",
    documentationUrl:
      "https://platform.moonshot.ai/docs/guide/start-using-kimi-api",
  },
  {
    id: "glm-coding",
    name: "GLM / Z.ai (Coding Plan)",
    provider: "zai",
    environmentVariable: "ZAI_API_KEY",
    documentationUrl: "https://docs.z.ai/devpack/overview",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    provider: "deepseek",
    environmentVariable: "DEEPSEEK_API_KEY",
    documentationUrl: "https://api-docs.deepseek.com/",
  },
] as const;

export function listPiApiProviders() {
  return { providers: PI_API_PROVIDERS.map((provider) => ({ ...provider })) };
}
