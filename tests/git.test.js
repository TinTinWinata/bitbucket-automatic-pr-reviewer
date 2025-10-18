const fs = require('fs');
const path = require('path');

jest.mock('fs');
jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

const mockExecAsync = jest.fn();
jest.mock('util', () => ({
  promisify: jest.fn(() => mockExecAsync),
}));

jest.mock('../src/logger', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const {
  projectExists,
  cloneRepository,
  updateRepository,
  ensureProjectExists,
} = require('../src/git');

const PROJECTS_DIR = '/app/projects';

describe('git.js Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('projectExists', () => {
    test('should return true if project directory exists', () => {
      const projectName = 'test-project';
      const expectedPath = path.join(PROJECTS_DIR, projectName);

      fs.existsSync.mockReturnValue(true);
      const result = projectExists(projectName);

      expect(result).toBe(true);
      expect(fs.existsSync).toHaveBeenCalledWith(expectedPath);
    });

    test('should return false if project directory does not exist', () => {
      const projectName = 'nonexistent-project';
      const expectedPath = path.join(PROJECTS_DIR, projectName);

      fs.existsSync.mockReturnValue(false);
      const result = projectExists(projectName);

      expect(result).toBe(false);
      expect(fs.existsSync).toHaveBeenCalledWith(expectedPath);
    });
  });

  describe('cloneRepository', () => {
    test('should clone repository successfully', async () => {
      const projectName = 'test-repo';
      const cloneUrl = 'https://bitbucket.org/test/repo.git';

      fs.existsSync.mockReturnValue(true);
      fs.mkdirSync.mockImplementation(() => {});
      mockExecAsync.mockResolvedValue({
        stdout: 'Cloning into test-repo...',
        stderr: 'Cloning into test-repo...',
      });

      const result = await cloneRepository(projectName, cloneUrl);

      expect(result.message).toBe('Repository cloned successfully');
      expect(result.success).toBe(true);
    });

    test('should handle clone failure', async () => {
      const projectName = 'test-repo';
      const cloneUrl = 'https://bitbucket.org/test/repo.git';

      fs.existsSync.mockReturnValue(true);
      mockExecAsync.mockRejectedValue(new Error('Repository not found'));

      await expect(cloneRepository(projectName, cloneUrl)).rejects.toThrow(
        'Failed to clone repository: Repository not found',
      );
    });
  });
  describe('updateRepository', () => {
    test('should throw error when project directory does not exist', async () => {
      const projectName = 'test-project';
      const branch = 'main';
      const expectedPath = path.join(PROJECTS_DIR, projectName);

      fs.existsSync.mockReturnValue(false);

      await expect(updateRepository(projectName, branch)).rejects.toThrow(
        `Project ${projectName} does not exist at ${expectedPath}`,
      );

      expect(fs.existsSync).toHaveBeenCalledWith(expectedPath);
    });

    test('should update repository successfully when directory exists', async () => {
      const projectName = 'test-project';
      const branch = 'main';
      const expectedPath = path.join(PROJECTS_DIR, projectName);

      fs.existsSync.mockReturnValue(true);
      mockExecAsync.mockResolvedValue({
        stdout: 'Already up to date.',
        stderr: '',
      });

      const result = await updateRepository(projectName, branch);

      expect(result).toEqual({
        success: true,
        path: expectedPath,
        message: 'Repository updated successfully',
      });
    });
  });

  describe('ensureProjectExists', () => {
    test('should update existing project', async () => {
      const repoData = {
        name: 'test-repo',
        cloneUrl: 'https://test.git',
        sourceBranch: 'main',
      };

      fs.existsSync.mockReturnValue(true);
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await ensureProjectExists(repoData);

      expect(result).toEqual({
        success: true,
        path: path.join(PROJECTS_DIR, 'test-repo'),
        wasCloned: false,
        message: 'Project exists and updated',
      });
    });

    test('should clone new project', async () => {
      const repoData = {
        name: 'new-repo',
        cloneUrl: 'https://test.git',
        sourceBranch: 'main',
      };

      fs.existsSync.mockReturnValueOnce(false).mockReturnValue(true);
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await ensureProjectExists(repoData);

      expect(result.wasCloned).toBe(true);
      expect(result.success).toBe(true);
    });

    test('should continue when update fails', async () => {
      const repoData = {
        name: 'test-repo',
        cloneUrl: 'https://test.git',
        sourceBranch: 'main',
      };

      fs.existsSync.mockReturnValue(true);
      mockExecAsync.mockRejectedValue(new Error('Update failed'));

      const result = await ensureProjectExists(repoData);

      expect(result).toEqual({
        success: true,
        path: path.join(PROJECTS_DIR, 'test-repo'),
        wasCloned: false,
        message: 'Project exists (update failed but continuing)',
      });
    });
  });
});
