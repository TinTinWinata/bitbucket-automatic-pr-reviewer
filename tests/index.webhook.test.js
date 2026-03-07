const request = require('supertest');

const basePrPayload = () => ({
  pullrequest: {
    title: 'My Test PR',
    description: 'A test description',
    author: { display_name: 'PR Author' },
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

const commentPayload = (overrides = {}) => ({
  ...basePrPayload(),
  actor: { display_name: 'Comment User' },
  comment: {
    id: 1001,
    content: {
      raw: '@review-bot review this',
    },
  },
  ...overrides,
});

function loadAppWithEnv(envOverrides = {}) {
  jest.resetModules();
  process.env = { ...process.env, ...envOverrides };

  jest.doMock('../src/claude', () => ({
    processPullRequest: jest.fn().mockResolvedValue({ success: true }),
  }));

  jest.doMock('../src/branch-matcher', () => ({
    shouldRunReview: jest.fn(() => true),
    shouldCreateReleaseNote: jest.fn(() => false),
  }));

  return require('../src/index');
}

describe('webhook endpoint', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
    jest.clearAllMocks();
    jest.dontMock('../src/claude');
    jest.dontMock('../src/branch-matcher');
  });

  it('enqueues review for valid manual trigger comment', async () => {
    const { app, _internal } = loadAppWithEnv({ BITBUCKET_USER: 'review-bot' });
    _internal.processedCommentTriggerIds.clear();
    const { processPullRequest } = require('../src/claude');

    const res = await request(app)
      .post('/webhook/bitbucket/pr')
      .set('x-event-key', 'pullrequest:comment_created')
      .send(commentPayload());

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(res.status).toBe(200);
    expect(res.body.enqueued).toEqual(['review']);
    expect(processPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'review',
        prData: expect.objectContaining({
          triggerType: 'manual-comment',
          triggeredBy: 'Comment User',
        }),
      }),
    );
  });

  it('ignores non-trigger comments', async () => {
    const { app } = loadAppWithEnv({ BITBUCKET_USER: 'review-bot' });

    const res = await request(app)
      .post('/webhook/bitbucket/pr')
      .set('x-event-key', 'pullrequest:comment_created')
      .send(
        commentPayload({
          comment: {
            id: 1002,
            content: { raw: '@review-bot looks good to me' },
          },
        }),
      );

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('Comment ignored');
  });

  it('skips comment from NON_ALLOWED_USERS', async () => {
    const { app } = loadAppWithEnv({
      BITBUCKET_USER: 'review-bot',
      NON_ALLOWED_USERS: 'Blocked User',
    });

    const res = await request(app)
      .post('/webhook/bitbucket/pr')
      .set('x-event-key', 'pullrequest:comment_created')
      .send(commentPayload({ actor: { display_name: 'Blocked User' } }));

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('Skipping comment from user');
  });

  it('keeps existing created/updated PR event behavior', async () => {
    const { app } = loadAppWithEnv({ PROCESS_ONLY_CREATED: 'false' });

    const createdRes = await request(app)
      .post('/webhook/bitbucket/pr')
      .set('x-event-key', 'pullrequest:created')
      .send(basePrPayload());

    const updatedRes = await request(app)
      .post('/webhook/bitbucket/pr')
      .set('x-event-key', 'pullrequest:updated')
      .send(basePrPayload());

    expect(createdRes.status).toBe(200);
    expect(createdRes.body.enqueued).toEqual(['review']);
    expect(updatedRes.status).toBe(200);
    expect(updatedRes.body.enqueued).toEqual(['review']);
  });

  it('does not block manual trigger when PROCESS_ONLY_CREATED=true', async () => {
    const { app } = loadAppWithEnv({
      PROCESS_ONLY_CREATED: 'true',
      BITBUCKET_USER: 'review-bot',
    });

    const res = await request(app)
      .post('/webhook/bitbucket/pr')
      .set('x-event-key', 'pullrequest:comment_created')
      .send(commentPayload({ comment: { id: 1005, content: { raw: '@review-bot review now' } } }));

    expect(res.status).toBe(200);
    expect(res.body.enqueued).toEqual(['review']);
  });
});
