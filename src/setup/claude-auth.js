const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const chalk = require('chalk');

class ClaudeAuthHandler {
  constructor() {
    this.claudeConfigDir = path.join(process.cwd(), 'claude-config');
    this.userClaudeDir = path.join(os.homedir(), '.claude');
    this.userClaudeConfig = path.join(os.homedir(), '.claude.json');
  }

  /**
   * Check if Claude CLI is installed and accessible
   */
  async checkClaudeInstallation() {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    try {
      await execAsync('claude --version', { timeout: 10000 });
      return true;
    } catch (error) {
      console.error(chalk.red('✗ Failed to check Claude installation:'), error.message);
      return false;
    }
  }

  /**
   * Check if user has existing Claude configuration
   */
  async checkExistingClaudeConfig() {
    const hasConfig = await fs.pathExists(this.userClaudeConfig);
    const hasDir = await fs.pathExists(this.userClaudeDir);

    return {
      hasConfig,
      hasDir,
      configPath: this.userClaudeConfig,
      dirPath: this.userClaudeDir,
    };
  }

  /**
   * Copy existing Claude configuration from user's home directory
   */
  async copyExistingClaudeConfig() {
    try {
      // Ensure claude-config directory exists
      await fs.ensureDir(this.claudeConfigDir);

      const existing = await this.checkExistingClaudeConfig();

      if (existing.hasConfig) {
        await fs.copy(existing.configPath, path.join(this.claudeConfigDir, '.claude.json'));
        console.log(chalk.green('✓ Copied existing Claude configuration'));
      }

      if (existing.hasDir) {
        await fs.copy(existing.dirPath, path.join(this.claudeConfigDir, '.claude'));
        console.log(chalk.green('✓ Copied existing Claude session data'));
      }

      return true;
    } catch (error) {
      console.error(chalk.red('✗ Failed to copy Claude configuration:'), error.message);
      return false;
    }
  }

  /**
   * Generate Claude configuration from API key
   */
  async generateClaudeConfigFromAPI(apiKey, model = 'sonnet') {
    try {
      await fs.ensureDir(this.claudeConfigDir);

      const claudeConfig = {
        apiKey: apiKey,
        model: model,
        dangerouslySkipPermissions: true,
      };

      const configPath = path.join(this.claudeConfigDir, '.claude.json');
      await fs.writeJSON(configPath, claudeConfig, { spaces: 2 });

      // Create empty .claude directory
      const claudeDir = path.join(this.claudeConfigDir, '.claude');
      await fs.ensureDir(claudeDir);

      console.log(chalk.green('✓ Generated Claude configuration from API key'));
      return true;
    } catch (error) {
      console.error(chalk.red('✗ Failed to generate Claude configuration:'), error.message);
      return false;
    }
  }

  /**
   * Generate Claude configuration for GLM model
   */
  async generateGLMConfig(apiKey, model = 'glm-4.6') {
    try {
      await fs.ensureDir(this.claudeConfigDir);

      const glmConfig = {
        provider: 'glm',
        apiKey: apiKey,
        model: model,
        baseURL: 'https://open.bigmodel.cn/api/paas/v4/',
        dangerouslySkipPermissions: true,
      };

      const configPath = path.join(this.claudeConfigDir, '.claude.json');
      await fs.writeJSON(configPath, glmConfig, { spaces: 2 });

      // Create empty .claude directory
      const claudeDir = path.join(this.claudeConfigDir, '.claude');
      await fs.ensureDir(claudeDir);

      console.log(chalk.green(`✓ Generated GLM configuration for model: ${model}`));
      return true;
    } catch (error) {
      console.error(chalk.red('✗ Failed to generate GLM configuration:'), error.message);
      return false;
    }
  }

  /**
   * Validate Claude configuration by attempting to run a simple Claude command
   */
  async validateClaudeConfig() {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    try {
      // Set environment to use our config directory
      const env = {
        ...process.env,
        HOME: this.claudeConfigDir,
        USERPROFILE: this.claudeConfigDir,
      };

      // Test Claude CLI with a simple command
      await execAsync('claude --version', {
        timeout: 15000,
        env,
        cwd: this.claudeConfigDir,
      });

      return true;
    } catch (error) {
      console.error(chalk.red('✗ Claude configuration validation failed:'), error.message);
      return false;
    }
  }

  /**
   * Generate webhook secret
   */
  generateWebhookSecret() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Get available models for different providers
   */
  getAvailableModels() {
    return {
      claude: ['sonnet', 'haiku', 'opus'],
      glm: ['glm-4.6', 'glm-4', 'glm-3-turbo'],
    };
  }

  /**
   * Show instructions for Claude authentication methods
   */
  showAuthInstructions(method) {
    const instructions = {
      session: chalk.blue(`
Session-based Authentication Instructions:
1. Make sure you have Claude CLI installed: npm install -g @anthropic-ai/claude-code
2. Run: claude auth login
3. Follow the browser authentication process
4. We'll copy your existing session automatically

This method uses your existing Claude account and permissions.
`),
      api: chalk.blue(`
API Key Authentication Instructions:
1. Get your API key from: https://console.anthropic.com/
2. Make sure you have API access enabled for your account
3. We'll generate the configuration file automatically

This method uses API calls instead of your browser session.
`),
      glm: chalk.blue(`
GLM Model Authentication Instructions:
1. Get your API key from: https://open.bigmodel.cn/
2. Sign up for a GLM (智谱AI) account
3. We'll generate the configuration for GLM models

This method uses GLM models instead of Claude.
`),
    };

    console.log(instructions[method] || '');
  }
}

module.exports = ClaudeAuthHandler;
