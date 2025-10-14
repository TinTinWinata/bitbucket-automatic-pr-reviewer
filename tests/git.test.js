const fs = require('fs');
const path = require('path');

// Mock fs module
jest.mock('fs');

// Mock logger
jest.mock('../src/logger', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

const { projectExists } = require('../src/git');

describe('git.js Unit Tests', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
  });

describe('projectExists', () => {
  const PROJECTS_DIR = '/app/projects';

  test('should return true if project directory exists', () => {
    const projectName = 'test-project';
    const expectedPath = path.join(PROJECTS_DIR, projectName);

    fs.existsSync.mockReturnValue(true);
    const result = projectExists(projectName);

    expect(result).toBe(true);

    expect(fs.existsSync).toHaveBeenCalledWith(expectedPath);

    expect(fs.existsSync).toHaveBeenCalledTimes(1);
  });

  test('should return false if project directory does not exist', () => {
    const projectName = 'nonexistent-project';
    const expectedPath = path.join(PROJECTS_DIR, projectName);

    fs.existsSync.mockReturnValue(false);
    const result = projectExists(projectName);

    expect(result).toBe(false);
    expect(fs.existsSync).toHaveBeenCalledWith(expectedPath);
    expect(fs.existsSync).toHaveBeenCalledTimes(1);
  });
})});
