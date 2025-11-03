// src/schemas.js
const { z } = require('zod');

// Regex to validate branch names are "safe"
const safeBranchString = z.string().regex(/^[a-zA-Z0-9_./-]+$/);

// Define the exact shape of the Bitbucket payload we accept
const BitbucketPayloadSchema = z.object({
  pullrequest: z.object({
    title: z.string().min(1),
    description: z.string().optional().nullable(),
    author: z.object({
      display_name: z.string(),
    }),
    source: z.object({
      branch: z.object({
        name: safeBranchString,
      }),
    }),
    destination: z.object({
      branch: z.object({
        name: safeBranchString,
      }),
    }),
    links: z.object({
      html: z.object({
        href: z.string().url(),
      }),
    }),
  }),
  repository: z.object({
    name: z.string(),
    links: z.object({
      clone: z
        .array(
          z.object({
            name: z.string(),
            href: z.string().url(),
          }),
        )
        .optional(),
      html: z.object({
        href: z.string().url(),
      }),
    }),
  }),
});

module.exports = { BitbucketPayloadSchema };
