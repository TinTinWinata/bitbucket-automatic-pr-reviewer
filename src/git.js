const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const logger = require('./logger').default;

const execAsync = promisify(exec);

const PROJECTS_DIR = '/app/projects';

/**
 * Check if a project directory exists
 * @param {string} projectName - Name of the project/repository
 * @returns {boolean} - True if project exists
 */
function projectExists(projectName) {
  const projectPath = path.join(PROJECTS_DIR, projectName);
  return fs.existsSync(projectPath);
}

/**
 * Clone a Bitbucket repository
 * @param {string} cloneUrl - Repository clone URL
 * @param {string} projectName - Name of the project/repository
 * @returns {Promise<Object>} - Result with success status and path
 */
async function cloneRepository(cloneUrl, projectName) {
  try {
    logger.info(`Cloning repository: ${projectName}`);

    // Ensure projects directory exists
    if (!fs.existsSync(PROJECTS_DIR)) {
      fs.mkdirSync(PROJECTS_DIR, { recursive: true });
      logger.info(`Created projects directory: ${PROJECTS_DIR}`);
    }

    const projectPath = path.join(PROJECTS_DIR, projectName);

    // Clone the repository (credentials are handled by Git's credential helper)
    const { stderr } = await execAsync(
      `git clone "${cloneUrl}" "${projectPath}"`,
      { maxBuffer: 1024 * 1024 * 10 }, // 10MB buffer
    );

    if (stderr && !stderr.includes('Cloning into')) {
      logger.warn(`Git clone warning: ${stderr}`);
    }

    logger.info(`Successfully cloned ${projectName} to ${projectPath}`);

    return {
      success: true,
      path: projectPath,
      message: 'Repository cloned successfully',
    };
  } catch (error) {
    logger.error(`Error cloning repository ${projectName}: ${error.message}`);
    throw new Error(`Failed to clone repository: ${error.message}`);
  }
}

/**
 * Update an existing repository (git pull)
 * @param {string} projectName - Name of the project/repository
 * @param {string} branch - Branch to checkout and pull (optional)
 * @returns {Promise<Object>} - Result with success status
 */
async function updateRepository(projectName, branch) {
  try {
    const projectPath = path.join(PROJECTS_DIR, projectName);

    if (!fs.existsSync(projectPath)) {
      throw new Error(`Project ${projectName} does not exist at ${projectPath}`);
    }

    logger.info(`Updating repository: ${projectName}`);

    // Fetch latest changes (credentials are handled by Git's credential helper)
    await execAsync(`git -C "${projectPath}" fetch --all`);

    logger.debug(`Branch: ${branch}`);

    // Reset to match remote branch exactly (avoids divergent branches issues)
    const branchName = branch || 'main';
    const { stdout } = await execAsync(`git -C "${projectPath}" reset --hard origin/${branchName}`);
    logger.debug(`Reset output: ${stdout}`);

    return {
      success: true,
      path: projectPath,
      message: 'Repository updated successfully',
    };
  } catch (error) {
    logger.error(`Issue when updating repository ${projectName}: ${error.message}`);
    throw new Error(`Failed to update repository: ${error.message}`);
  }
}

/**
 * Get diff between source and destination branch using merge-base
 * This ensures we only get changes from the PR author, not changes merged into destination
 * @param {string} projectPath - Path to the project repository
 * @param {string} sourceBranch - Source branch name
 * @param {string} destinationBranch - Destination branch name
 * @returns {Promise<Object>} - Result with diff content and size in bytes
 */
async function getDiffFromMergeBase(projectPath, sourceBranch, destinationBranch) {
  try {
    logger.info(`Getting diff from merge-base for ${sourceBranch} -> ${destinationBranch}`);

    // Ensure we have latest refs for both branches
    await execAsync(`git -C "${projectPath}" fetch origin ${sourceBranch} ${destinationBranch}`, {
      maxBuffer: 1024 * 1024 * 10, // 10MB buffer
    });

    // Find the merge base (common ancestor)
    let mergeBase;
    try {
      const { stdout } = await execAsync(
        `git -C "${projectPath}" merge-base origin/${destinationBranch} origin/${sourceBranch}`,
      );
      mergeBase = stdout.trim();
      logger.debug(`Merge base found: ${mergeBase}`);
    } catch (error) {
      // If merge-base fails (e.g., branches have no common ancestor), fall back to destination branch
      logger.warn(`Could not find merge-base, using destination branch as base: ${error.message}`);
      mergeBase = `origin/${destinationBranch}`;
    }

    // Get diff from merge-base to source branch (only PR author's changes)
    const { stdout: diff } = await execAsync(
      `git -C "${projectPath}" diff ${mergeBase}..origin/${sourceBranch}`,
      { maxBuffer: 1024 * 1024 * 50 }, // 50MB buffer for large diffs
    );

    const diffSize = Buffer.byteLength(diff, 'utf8');
    logger.info(`Diff size: ${(diffSize / 1024).toFixed(2)} KB`);

    return {
      success: true,
      diff,
      size: diffSize,
      mergeBase,
    };
  } catch (error) {
    logger.error(`Error getting diff from merge-base: ${error.message}`);
    throw new Error(`Failed to get diff from merge-base: ${error.message}`);
  }
}

/**
 * Ensure project exists, clone if necessary
 * @param {Object} repoData - Repository data from webhook
 * @returns {Promise<Object>} - Result with success status and path
 */
async function ensureProjectExists(repoData) {
  const projectName = repoData.name;
  const cloneUrl = repoData.cloneUrl;

  logger.info(`Checking if project ${projectName} exists...`);

  if (!repoData.sourceBranch) {
    return {
      success: false,
      message: 'Source branch is required',
    };
  }

  if (projectExists(projectName)) {
    logger.info(`Project ${projectName} already exists`);

    try {
      // Fetch all branches to ensure we have latest refs
      const projectPath = path.join(PROJECTS_DIR, projectName);
      await execAsync(`git -C "${projectPath}" fetch --all`);

      // Reset to source branch
      await execAsync(`git -C "${projectPath}" reset --hard origin/${repoData.sourceBranch}`);

      return {
        success: true,
        path: projectPath,
        wasCloned: false,
        message: 'Project exists and updated',
      };
    } catch (error) {
      logger.warn(`Could not update repository, continuing with existing: ${error.message}`);
      return {
        success: false,
        path: path.join(PROJECTS_DIR, projectName),
        wasCloned: false,
        message: 'Project exists (update failed but continuing)',
      };
    }
  } else {
    logger.info(`Project ${projectName} does not exist, cloning...`);
    const result = await cloneRepository(cloneUrl, projectName);
    return {
      ...result,
      wasCloned: true,
    };
  }
}

module.exports = {
  projectExists,
  cloneRepository,
  updateRepository,
  ensureProjectExists,
  getDiffFromMergeBase,
};
