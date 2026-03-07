const {
  parseManualReviewTrigger,
  getCommentText,
  getCommentAuthor,
  getCommentId,
} = require('../src/manual-trigger');

describe('manual-trigger', () => {
  const baseConfig = {
    requireMention: true,
    keywords: ['review'],
    botNames: ['review-bot'],
  };

  it('matches keyword + mention command', () => {
    const result = parseManualReviewTrigger('@review-bot review this PR', baseConfig);
    expect(result.shouldTrigger).toBe(true);
  });

  it('rejects when mention is required but missing', () => {
    const result = parseManualReviewTrigger('review this PR', baseConfig);
    expect(result.shouldTrigger).toBe(false);
    expect(result.reason).toBe('missing-mention');
  });

  it('allows command without mention when configured', () => {
    const result = parseManualReviewTrigger('review this PR', {
      ...baseConfig,
      requireMention: false,
    });
    expect(result.shouldTrigger).toBe(true);
  });

  it('extracts comment metadata from payload', () => {
    const payload = {
      actor: { display_name: 'Alice' },
      comment: {
        id: 42,
        content: { raw: '@review-bot review' },
      },
    };
    expect(getCommentText(payload)).toBe('@review-bot review');
    expect(getCommentAuthor(payload)).toBe('Alice');
    expect(getCommentId(payload)).toBe('42');
  });
});
