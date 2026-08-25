import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  AUTH_URL: z.string().optional(),
  ENCRYPTION_KEY: z
    .string()
    .min(32, "ENCRYPTION_KEY must be at least 32 characters"),
  AUTH_GITHUB_ID: z.string().optional(),
  AUTH_GITHUB_SECRET: z.string().optional(),
  AUTH_GOOGLE_ID: z.string().optional(),
  AUTH_GOOGLE_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function getEnv(): Env {
  return envSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_URL: process.env.AUTH_URL || undefined,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    AUTH_GITHUB_ID: process.env.AUTH_GITHUB_ID || undefined,
    AUTH_GITHUB_SECRET: process.env.AUTH_GITHUB_SECRET || undefined,
    AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID || undefined,
    AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET || undefined,
  });
}

export function oauthEnabled() {
  return {
    github: Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET),
    google: Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET),
  };
}
