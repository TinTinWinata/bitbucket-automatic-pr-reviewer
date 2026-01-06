const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');

class ConfigGenerator {
  constructor() {
    this.projectRoot = process.cwd();
    this.envPath = path.join(this.projectRoot, '.env');
    this.claudeConfigPath = path.join(this.projectRoot, 'claude-config', '.claude.json');
  }

  /**
   * Generate .env file from user configuration
   */
  async generateEnvFile(config) {
    try {
      let envContent = '# PR Automation Service Configuration\n\n';

      // Server Configuration
      envContent += '# Server Configuration\n';
      envContent += `PORT=${config.port || 3000}\n\n`;

      // Claude Model Configuration
      envContent += '# Claude Model Configuration\n';
      if (config.claudeProvider === 'glm') {
        envContent += `CLAUDE_MODEL=${config.claudeModel || 'glm-4.6'}\n`;
      } else {
        envContent += `CLAUDE_MODEL=${config.claudeModel || 'sonnet'}\n`;
      }
      envContent += `CLAUDE_TIMEOUT_CONFIG=${config.claudeTimeout || 10}\n`;
      envContent += '# Maximum diff size in KB to include directly in prompt (default: 100KB)\n';
      envContent += '# If diff exceeds this, merge-base instructions will be added instead\n';
      envContent += `MAX_DIFF_SIZE_KB=${config.maxDiffSizeKB || 100}\n\n`;

      // Bitbucket Configuration
      envContent += '# Bitbucket Configuration\n';
      if (config.bitbucketToken) {
        envContent += `BITBUCKET_TOKEN=${config.bitbucketToken}\n`;
      }
      if (config.bitbucketUser) {
        envContent += `BITBUCKET_USER=${config.bitbucketUser}\n`;
      }
      envContent += '\n';

      // Webhook Security
      envContent += '# Webhook Security\n';
      if (config.webhookSecret) {
        envContent += `BITBUCKET_WEBHOOK_SECRET=${config.webhookSecret}\n`;
      }
      envContent += `ALLOWED_WORKSPACE=${config.workspace || 'xriopteam'}\n\n`;

      // Event Filtering
      envContent += '# Event Filtering\n';
      envContent += `# Set to 'true' to only process PR creation events (ignore updates)\n`;
      envContent += `# Set to 'false' to process all PR events (created + updated)\n`;
      envContent += `PROCESS_ONLY_CREATED=${config.processOnlyCreated ? 'true' : 'false'}\n`;

      // User Filtering
      if (config.nonAllowedUsers) {
        envContent += `# Skip reviews for these users (comma-separated display names)\n`;
        envContent += `NON_ALLOWED_USERS=${config.nonAllowedUsers}\n`;
      }
      envContent += '\n';

      // Logging Configuration
      envContent += '# Logging Configuration\n';
      envContent += '# Log level: error, warn, info, debug (default: environment-based)\n';
      envContent += `LOG_LEVEL=${config.logLevel || 'info'}\n`;
      envContent += '# Log file retention in days (default: 30)\n';
      envContent += `LOG_FILE_RETENTION_DAYS=${config.logRetention || 30}\n`;
      envContent += '# Maximum log file size before rotation (default: 20m)\n';
      envContent += `LOG_MAX_FILE_SIZE=${config.logMaxSize || '20m'}\n`;
      envContent += '# Enable console logging (default: true)\n';
      envContent += `LOG_ENABLE_CONSOLE=${config.logConsole !== false ? 'true' : 'false'}\n`;
      envContent += '# Enable file logging (default: true)\n';
      envContent += `LOG_ENABLE_FILE=${config.logFile !== false ? 'true' : 'false'}\n\n`;

      // Metrics Persistence Configuration
      envContent += '# Metrics Persistence Configuration\n';
      envContent += '# Enable metrics persistence to survive restarts/rebuilds (default: false)\n';
      envContent += `METRICS_PERSISTENCE_ENABLED=${config.metricsPersistenceEnabled === true ? 'true' : 'false'}\n`;
      if (config.metricsPersistenceEnabled) {
        envContent += "# Storage type: 'filesystem' or 'sqlite' (default: filesystem)\n";
        envContent += `METRICS_PERSISTENCE_TYPE=${config.metricsPersistenceType || 'filesystem'}\n`;
        envContent += '# Path to store metrics (default: ./metrics-storage)\n';
        envContent += `METRICS_PERSISTENCE_PATH=${config.metricsPersistencePath || './metrics-storage'}\n`;
        envContent += '# Save interval in milliseconds (default: 30000 = 30 seconds)\n';
        envContent += `METRICS_PERSISTENCE_SAVE_INTERVAL_MS=${config.metricsPersistenceSaveInterval || 30000}\n`;
      }
      envContent += '\n';

      await fs.writeFile(this.envPath, envContent);
      console.log(chalk.green('✓ Generated .env file'));
      return true;
    } catch (error) {
      console.error(chalk.red('✗ Failed to generate .env file:'), error.message);
      return false;
    }
  }

  /**
   * Generate or update MCP servers in .claude.json configuration
   */
  async generateMcpConfig(config) {
    try {
      // Ensure claude-config directory exists
      await fs.ensureDir(path.dirname(this.claudeConfigPath));

      let claudeConfig;

      // Check if .claude.json already exists
      if (await fs.pathExists(this.claudeConfigPath)) {
        claudeConfig = await fs.readJSON(this.claudeConfigPath);
      } else {
        claudeConfig = {};
      }

      // Ensure mcpServers object exists at root level (user-level configuration)
      if (!claudeConfig.mcpServers) {
        claudeConfig.mcpServers = {};
      }

      // Add Bitbucket server configuration if provided
      if (config.bitbucketUserEmail && config.bitbucketToken) {
        claudeConfig.mcpServers['bit-bucket-server'] = {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@tintinwinata/mcp-server-atlassian-bitbucket'],
          env: {
            ATLASSIAN_USER_EMAIL: config.bitbucketUserEmail,
            ATLASSIAN_API_TOKEN: config.bitbucketToken,
          },
        };
        console.log(chalk.green('✓ Added Bitbucket MCP server configuration to .claude.json'));
      }

      await fs.writeJSON(this.claudeConfigPath, claudeConfig, { spaces: 2 });
      return true;
    } catch (error) {
      console.error(chalk.red('✗ Failed to update .claude.json with MCP servers:'), error.message);
      return false;
    }
  }

  /**
   * Show configuration preview before finalizing
   */
  showConfigurationPreview(config) {
    console.log(chalk.cyan('\n📋 Configuration Preview:'));
    console.log(chalk.cyan('─'.repeat(50)));

    console.log(chalk.yellow('\nClaude Configuration:'));
    console.log(`  Provider: ${config.claudeProvider || 'claude'}`);
    console.log(`  Model: ${config.claudeModel || 'sonnet'}`);
    console.log(`  Auth Method: ${config.authMethod || 'session'}`);

    console.log(chalk.yellow('\nBitbucket Configuration:'));
    console.log(`  Workspace: ${config.workspace || 'xriopteam'}`);
    console.log(`  User: ${config.bitbucketUser || 'Not set'}`);
    console.log(`  Email: ${config.bitbucketUserEmail || 'Not set'}`);
    console.log(`  Token: ${config.bitbucketToken ? '✓ Set' : '✗ Not set'}`);

    console.log(chalk.yellow('\nServer Configuration:'));
    console.log(`  Port: ${config.port || 3000}`);
    console.log(`  Process Only Created: ${config.processOnlyCreated ? 'Yes' : 'No'}`);
    console.log(`  Non-Allowed Users: ${config.nonAllowedUsers || 'None (all users allowed)'}`);
    console.log(`  Webhook Secret: ${config.webhookSecret ? '✓ Set' : '✗ Not set'}`);

    console.log(chalk.yellow('\nMetrics Persistence Configuration:'));
    console.log(`  Enabled: ${config.metricsPersistenceEnabled ? 'Yes' : 'No'}`);
    if (config.metricsPersistenceEnabled) {
      console.log(`  Type: ${config.metricsPersistenceType || 'filesystem'}`);
      console.log(`  Path: ${config.metricsPersistencePath || './metrics-storage'}`);
    }

    console.log(chalk.cyan('\n' + '─'.repeat(50)));
  }

  /**
   * Validate configuration before saving
   */
  validateConfiguration(config) {
    const errors = [];

    // Validate Claude configuration
    if (!config.claudeModel) {
      errors.push('Claude model is required');
    }

    // Validate Bitbucket configuration
    if (!config.bitbucketToken || !config.bitbucketUser || !config.bitbucketUserEmail) {
      errors.push('Bitbucket token, username, and email are required');
    }

    if (!config.workspace) {
      errors.push('Bitbucket workspace is required');
    }

    // Validate server configuration
    const port = parseInt(config.port);
    if (isNaN(port) || port < 1 || port > 65535) {
      errors.push('Port must be between 1 and 65535');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Create necessary directories
   */
  async createDirectories() {
    const directories = [
      path.join(this.projectRoot, 'logs'),
      path.join(this.projectRoot, 'projects'),
      path.join(this.projectRoot, 'claude-config'),
      path.join(this.projectRoot, 'metrics-storage'),
    ];

    for (const dir of directories) {
      await fs.ensureDir(dir);
    }

    console.log(chalk.green('✓ Created necessary directories'));
  }

  /**
   * Check if .env file already exists
   */
  async checkExistingEnv() {
    return await fs.pathExists(this.envPath);
  }

  /**
   * Backup existing .env file
   */
  async backupExistingEnv() {
    if (await this.checkExistingEnv()) {
      const backupPath = path.join(this.projectRoot, '.env.backup');
      await fs.copy(this.envPath, backupPath);
      console.log(chalk.yellow('⚠ Backed up existing .env file to .env.backup'));
    }
  }
}

module.exports = ConfigGenerator;
