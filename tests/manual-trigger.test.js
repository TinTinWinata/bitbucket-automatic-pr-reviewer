const {
  parseManualReviewTrigger,
  getCommentText,
  getCommentAuthor,
  getCommentId,
  extractMentionIds,
  textHasPrefixCommand,
  textHasBotMention,
} = require('../src/manual-trigger');

describe('manual-trigger', () => {
  const baseConfig = {
    prefixCommand: '/review',
    keywords: ['review'],
    botIds: ['12345:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'],
  };

  describe('Rule 1: /review prefix command', () => {
    it('matches /review alone', () => {
      const result = parseManualReviewTrigger('/review', baseConfig);
      expect(result.shouldTrigger).toBe(true);
      expect(result.reason).toBe('matched-prefix-command');
    });

    it('matches /review with trailing space', () => {
      const result = parseManualReviewTrigger('/review ', baseConfig);
      expect(result.shouldTrigger).toBe(true);
      expect(result.reason).toBe('matched-prefix-command');
    });

    it('matches /review followed by text', () => {
      const result = parseManualReviewTrigger('/review please check this PR', baseConfig);
      expect(result.shouldTrigger).toBe(true);
      expect(result.reason).toBe('matched-prefix-command');
    });

    it('matches /review with leading whitespace', () => {
      const result = parseManualReviewTrigger('  /review anything', baseConfig);
      expect(result.shouldTrigger).toBe(true);
      expect(result.reason).toBe('matched-prefix-command');
    });

    it('does not match review without slash', () => {
      const result = parseManualReviewTrigger('review this', baseConfig);
      expect(result.shouldTrigger).not.toBe(true);
    });
  });

  describe('Rule 2: mention + keyword', () => {
    it('matches Bitbucket mention ID + keyword', () => {
      const text = '@{12345:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee} review this';
      const result = parseManualReviewTrigger(text, baseConfig);
      expect(result.shouldTrigger).toBe(true);
      expect(result.reason).toBe('matched-mention-keyword');
    });

    it('rejects when mention is present but keyword missing', () => {
      const result = parseManualReviewTrigger(
        '@{12345:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee} looks good',
        baseConfig,
      );
      expect(result.shouldTrigger).toBe(false);
      expect(result.reason).toBe('missing-keyword');
    });

    it('rejects when keyword present but mention missing', () => {
      const result = parseManualReviewTrigger('review this PR', baseConfig);
      expect(result.shouldTrigger).toBe(false);
      expect(result.reason).toBe('missing-mention');
    });
  });

  describe('negative cases', () => {
    it('rejects empty comment', () => {
      const result = parseManualReviewTrigger('', baseConfig);
      expect(result.shouldTrigger).toBe(false);
      expect(result.reason).toBe('empty-comment');
    });

    it('rejects comment with neither prefix nor mention+keyword', () => {
      const result = parseManualReviewTrigger('please take a look', baseConfig);
      expect(result.shouldTrigger).toBe(false);
      expect(result.reason).toBe('missing-prefix-and-mention-keyword');
    });

    it('rejects mention of non-configured user ID', () => {
      const result = parseManualReviewTrigger(
        '@{99999:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx} review this',
        baseConfig,
      );
      expect(result.shouldTrigger).toBe(false);
    });
  });

  describe('helpers', () => {
    it('extracts mention IDs from Bitbucket raw format', () => {
      const text = '@{12345:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee} review';
      expect(extractMentionIds(text)).toEqual(['12345:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']);
    });

    it('textHasPrefixCommand matches /review prefix', () => {
      expect(textHasPrefixCommand('/review', '/review')).toBe(true);
      expect(textHasPrefixCommand('/review foo', '/review')).toBe(true);
      expect(textHasPrefixCommand('review', '/review')).toBe(false);
    });

    it('textHasBotMention matches configured bot ID', () => {
      const text = '@{12345:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee} review';
      expect(textHasBotMention(text, ['12345:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'])).toBe(true);
    });
  });

  describe('payload metadata', () => {
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
});
