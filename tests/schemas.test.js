const { BitbucketPayloadSchema } = require('../src/schemas');

// A minimal, valid payload that should pass validation
const createValidPayload = () => ({
  pullrequest: {
    title: 'My Test PR',
    description: 'A test description',
    author: { display_name: 'Test User' },
    source: { branch: { name: 'feature/new-thing' } },
    destination: { branch: { name: 'main' } },
    links: { html: { href: 'https://bitbucket.org/team/repo/pull/1' } },
  },
  repository: {
    name: 'repo',
    links: {
      clone: [{ name: 'https', href: 'https://user@bitbucket.org/team/repo.git' }],
      html: { href: 'https://bitbucket.org/team/repo' },
    },
  },
});

describe('BitbucketPayloadSchema', () => {
  it('should pass validation for a valid payload', () => {
    const payload = createValidPayload();
    expect(() => BitbucketPayloadSchema.parse(payload)).not.toThrow();
  });

  it('should fail validation if a required field is missing (e.g., title)', () => {
    const payload = createValidPayload();
    delete payload.pullrequest.title; // Remove required field
    expect(() => BitbucketPayloadSchema.parse(payload)).toThrow();
  });

  it('should fail validation for an unsafe source branch name', () => {
    const payload = createValidPayload();
    payload.pullrequest.source.branch.name = 'feature/branch; rm -rf /'; // Malicious string
    expect(() => BitbucketPayloadSchema.parse(payload)).toThrow();
  });

  it('should fail validation for an invalid clone URL', () => {
    const payload = createValidPayload();
    payload.repository.links.clone[0].href = 'not-a-url'; // Invalid URL
    expect(() => BitbucketPayloadSchema.parse(payload)).toThrow();
  });
});
