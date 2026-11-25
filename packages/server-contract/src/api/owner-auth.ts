import { z } from "zod";

export const ownerAuthStatusSchema = z
  .object({
    enabled: z.boolean(),
    authenticated: z.boolean(),
  })
  .strict();

export const ownerAuthLoginSchema = z
  .object({
    username: z.string().min(1).max(128),
    password: z.string().min(1).max(512),
  })
  .strict();

export type OwnerAuthStatus = z.infer<typeof ownerAuthStatusSchema>;
export type OwnerAuthLogin = z.infer<typeof ownerAuthLoginSchema>;

export const OWNER_AUTH_PATHS = {
  status: "/api/v1/owner-auth/status",
  login: "/api/v1/owner-auth/login",
  logout: "/api/v1/owner-auth/logout",
} as const;
