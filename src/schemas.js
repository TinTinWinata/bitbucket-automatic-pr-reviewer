// src/schemas.js
const { z } = require('zod');

// Regex to validate branch names are "safe"
const safeBranchString = z.string().regex(/^[a-zA-Z0-9_./-]+$/);

const pullRequestSchema = z.object({
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
});

const repositorySchema = z.object({
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
});

// Define the exact shape of the Bitbucket payload we accept
const BitbucketPayloadSchema = z.object({
  pullrequest: pullRequestSchema,
  repository: repositorySchema,
});

const BitbucketCommentPayloadSchema = z.object({
  pullrequest: pullRequestSchema,
  repository: repositorySchema,
  comment: z.object({
    id: z.union([z.number(), z.string()]).optional(),
    content: z
      .object({
        raw: z.string().min(1),
      })
      .passthrough(),
    user: z
      .object({
        display_name: z.string().optional(),
      })
      .optional(),
  }),
  actor: z
    .object({
      display_name: z.string().optional(),
    })
    .optional(),
});

module.exports = { BitbucketPayloadSchema, BitbucketCommentPayloadSchema };
