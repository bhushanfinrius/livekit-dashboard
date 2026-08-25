import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export const signupSchema = z.object({
  name: z.string().trim().max(80).optional(),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "Password must be at least 8 characters").max(100),
});

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Project name is required").max(80),
  livekitUrl: z
    .string()
    .trim()
    .min(1, "LiveKit URL is required")
    .refine(
      (value) => /^(https?|wss?):\/\//i.test(value),
      "URL must start with http(s):// or ws(s)://",
    ),
  livekitApiKey: z.string().trim().min(1, "API key is required"),
  livekitApiSecret: z
    .string()
    .min(32, "API secret must be at least 32 characters (LiveKit 1.13+)"),
});

export const joinProjectSchema = z.object({
  joinCode: z
    .string()
    .trim()
    .min(4, "Join code is required")
    .max(16)
    .transform((value) => value.toUpperCase()),
});

const publicLivekitUrlSchema = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || /^(https?|wss?):\/\//i.test(value),
    "Public URL must start with http(s):// or ws(s)://",
  );

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1, "Project name is required").max(80).optional(),
    livekitUrl: createProjectSchema.shape.livekitUrl.optional(),
    publicLivekitUrl: publicLivekitUrlSchema.optional(),
    livekitApiKey: z.string().trim().min(1, "API key is required").optional(),
    livekitApiSecret: z
      .string()
      .max(200)
      .refine(
        (value) => value === "" || value.length >= 32,
        "API secret must be at least 32 characters (LiveKit 1.13+)",
      )
      .optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.livekitUrl !== undefined ||
      value.publicLivekitUrl !== undefined ||
      value.livekitApiKey !== undefined ||
      (value.livekitApiSecret !== undefined && value.livekitApiSecret !== ""),
    "Nothing to update",
  );

export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(["owner", "member"]).default("member"),
});

export const updateMemberRoleSchema = z.object({
  role: z.enum(["owner", "member"]),
});

export const deleteProjectSchema = z.object({
  confirmName: z.string().trim().min(1, "Type the project name to confirm"),
});
