const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');

class ConfigGenerator {
  constructor() {
    this.projectRoot = process.cwd();
    this.envPath = path.join(this.projectRoot, '.env');
    this.mcpPath = path.join(this.projectRoot, '.mcp.json');
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
      envContent += `CLAUDE_TIMEOUT_CONFIG=${config.claudeTimeout || 10}\n\n`;

      // Bitbucket Configuration
      envContent += '# Bitbucket Configuration\n';
      if (config.bitbucketToken) {
        envContent += `BITBUCKET_TOKEN=${config.bitbucketToken}\n`;
      }
      if (config.bitbucketUser) {
        envContent += `BITBUCKET_USER=${config.bitbucketUser}\n`;
      }
      if (config.bitbucketPassword) {
        envContent += `BITBUCKET_PASSWORD=${config.bitbucketPassword}\n`;
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
      envContent += `PROCESS_ONLY_CREATED=${config.processOnlyCreated ? 'true' : 'false'}\n\n`;

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
      envContent += `LOG_ENABLE_FILE=${config.logFile !== false ? 'true' : 'false'}\n`;

      await fs.writeFile(this.envPath, envContent);
      console.log(chalk.green('✓ Generated .env file'));
      return true;
    } catch (error) {
      console.error(chalk.red('✗ Failed to generate .env file:'), error.message);
      return false;
    }
  }

  /**
   * Generate or update .mcp.json configuration
   */
  async generateMcpConfig(config) {
    try {
      let mcpConfig;

      // Check if .mcp.json already exists
      if (await fs.pathExists(this.mcpPath)) {
        mcpConfig = await fs.readJSON(this.mcpPath);
      } else {
        mcpConfig = { mcpServers: {} };
      }

      // Add Bitbucket server configuration if provided
      if (config.bitbucketUser && config.bitbucketToken) {
        mcpConfig.mcpServers['bit-bucket-server'] = {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@tintinwinata/mcp-server-atlassian-bitbucket'],
          env: {
            ATLASSIAN_USER_EMAIL: config.bitbucketUser,
            ATLASSIAN_API_TOKEN: config.bitbucketToken,
          },
        };
        console.log(chalk.green('✓ Added Bitbucket MCP server configuration'));
      }

      await fs.writeJSON(this.mcpPath, mcpConfig, { spaces: 4 });
      return true;
    } catch (error) {
      console.error(chalk.red('✗ Failed to generate .mcp.json:'), error.message);
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
    console.log(`  Token: ${config.bitbucketToken ? '✓ Set' : '✗ Not set'}`);
    console.log(`  Password: ${config.bitbucketPassword ? '✓ Set' : '✗ Not set'}`);

    console.log(chalk.yellow('\nServer Configuration:'));
    console.log(`  Port: ${config.port || 3000}`);
    console.log(`  Process Only Created: ${config.processOnlyCreated ? 'Yes' : 'No'}`);
    console.log(`  Webhook Secret: ${config.webhookSecret ? '✓ Set' : '✗ Not set'}`);

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
    if (!config.bitbucketToken && (!config.bitbucketUser || !config.bitbucketPassword)) {
      errors.push('Either Bitbucket token or username+password is required');
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
