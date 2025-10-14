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
 * @param {string} repoUrl - Repository clone URL
 * @param {string} projectName - Name of the project/repository
 * @returns {Promise<Object>} - Result with success status and path
 */
async function cloneRepository(projectName, cloneUrl) {
  try {
    logger.info(`Cloning repository: ${projectName}`);
    
    // Ensure projects directory exists
    if (!fs.existsSync(PROJECTS_DIR)) {
      fs.mkdirSync(PROJECTS_DIR, { recursive: true });
      logger.info(`Created projects directory: ${PROJECTS_DIR}`);
    }

    const projectPath = path.join(PROJECTS_DIR, projectName);

    // Clone the repository (credentials are handled by Git's credential helper)
    const { stdout, stderr } = await execAsync(
      `git clone "${repoUrl}" "${projectPath}"`,
      { maxBuffer: 1024 * 1024 * 10 } // 10MB buffer
    );

    if (stderr && !stderr.includes('Cloning into')) {
      logger.warn('Git clone warning:', stderr);
    }

    logger.info(`Successfully cloned ${projectName} to ${projectPath}`);
    
    return {
      success: true,
      path: projectPath,
      message: 'Repository cloned successfully'
    };

  } catch (error) {
    logger.error(`Error cloning repository ${projectName}:`, error.message);
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

    logger.debug('Branch: ', branch)

    // Checkout branch if specified
    if (branch) {
      logger.info(`Checking out branch: ${branch}`);
      await execAsync(`git -C "${projectPath}" checkout "${branch}"`);
    }

    // Pull latest changes
    const { stdout } = await execAsync(`git -C "${projectPath}" pull`);
    logger.debug(`Update output: ${stdout}`);

    return {
      success: true,
      path: projectPath,
      message: 'Repository updated successfully'
    };

  } catch (error) {
    logger.error(`Error updating repository ${projectName}:`, error.message);
    throw new Error(`Failed to update repository: ${error.message}`);
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

  if (projectExists(projectName)) {
    logger.info(`Project ${projectName} already exists`);
    
    // Optionally update the repository
    try {
      await updateRepository(projectName, repoData.sourceBranch);
      return {
        success: true,
        path: path.join(PROJECTS_DIR, projectName),
        wasCloned: false,
        message: 'Project exists and updated'
      };
    } catch (error) {
      logger.warn('Could not update repository, continuing with existing:', error.message);
      return {
        success: true,
        path: path.join(PROJECTS_DIR, projectName),
        wasCloned: false,
        message: 'Project exists (update failed but continuing)'
      };
    }
  } else {
    logger.info(`Project ${projectName} does not exist, cloning...`);
    const result = await cloneRepository(cloneUrl, projectName);
    return {
      ...result,
      wasCloned: true
    };
  }
}

module.exports = {
  projectExists,
  cloneRepository,
  updateRepository,
  ensureProjectExists
};

