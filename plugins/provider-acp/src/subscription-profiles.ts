import { z } from "zod";

export const subscriptionAgentIdSchema = z.enum([
  "antigravity-acp",
  "kimi-code",
  "qwen-code",
]);

export const SUBSCRIPTION_AGENT_PROFILES = [
  {
    id: "antigravity-acp",
    name: "Google Antigravity",
    command: "agy",
    args: ["acp"],
    signInCommand: "agy acp --login",
    documentationUrl: "https://antigravity.google/docs/cli/acp/",
    requiresInstallation: true,
  },
  {
    id: "kimi-code",
    name: "Kimi Code",
    command: "npx",
    args: ["-y", "@moonshot-ai/kimi-code@2.7.3", "acp"],
    signInCommand: "npx -y @moonshot-ai/kimi-code@2.7.3 login",
    documentationUrl: "https://moonshotai.github.io/kimi-code/",
    requiresInstallation: false,
  },
  {
    id: "qwen-code",
    name: "Qwen Code",
    command: "npx",
    args: [
      "-y",
      "@qwen-code/qwen-code@0.28.4",
      "--acp",
      "--experimental-skills",
    ],
    signInCommand: "npx -y @qwen-code/qwen-code@0.28.4",
    documentationUrl:
      "https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/",
    requiresInstallation: false,
  },
] satisfies {
  id: z.infer<typeof subscriptionAgentIdSchema>;
  name: string;
  command: string;
  args: string[];
  signInCommand: string;
  documentationUrl: string;
  requiresInstallation: boolean;
}[];

