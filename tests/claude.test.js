jest.mock('../src/git', () => ({
  ensureProjectExists: jest.fn(),
}));

jest.mock('../src/metrics', () => ({
  claudeReviewSuccessCounter: { inc: jest.fn() },
  claudeReviewFailureCounter: { inc: jest.fn() },
  claudeReviewDurationHistogram: { observe: jest.fn() },
  claudeLgtmCounter: { inc: jest.fn() },
  claudeIssuesCounter: { inc: jest.fn() },
}));

jest.mock('../src/templateManager', () => {
  return jest.fn().mockImplementation(() => {
    return {
      getPromptForPR: jest.fn(() => 'Mocked PR prompt'),
    };
  });
});

jest.mock('../src/logger', () => ({
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('fs', () => ({
  writeFileSync: jest.fn(),
  readFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  existsSync: jest.fn(),
  copyFileSync: jest.fn(),
}));

jest.mock('child_process', () => ({
  spawn: jest.fn(),
  exec: jest.fn(),
}));

const claude = require('../src/claude');
const { ensureProjectExists } = require('../src/git');
const fs = require('fs');

describe('Claude.js Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    ensureProjectExists.mockResolvedValue({
      success: true,
      path: '/tmp/test-repo',
    });

    fs.readFileSync.mockReturnValue('Test content');
    fs.existsSync.mockReturnValue(true);
  });

  const mockPrData = {
    title: 'Test PR',
    author: 'test-author',
    repository: 'test-repo',
    repoCloneUrl: 'https://test.com/repo.git',
    sourceBranch: 'feature-branch',
  };

  test('should export processPullRequest function', () => {
    expect(claude).toHaveProperty('processPullRequest');
    expect(typeof claude.processPullRequest).toBe('function');
  });

  test('should handle git validation failure', async () => {
    ensureProjectExists.mockResolvedValueOnce({
      success: false,
    });

    await expect(claude.processPullRequest(mockPrData)).rejects.toThrow(
      'Failed to ensure project exists',
    );
  });
});
