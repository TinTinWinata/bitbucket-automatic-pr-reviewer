const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');

class ConfigGenerator {
  constructor() {
    this.projectRoot = process.cwd();
    this.envPath = path.join(this.projectRoot, '.env');
    this.claudeConfigPath = path.join(this.projectRoot, 'claude-config', '.claude.json');
    this.configJsonPath = path.join(this.projectRoot, 'src', 'config', 'config.json');
    this.dockerComposePath = path.join(this.projectRoot, 'docker-compose.yml');
  }

  /**
   * Validate at the beginning whether we can recreate configuration (permissions, paths).
   * If we cannot, the setup wizard should not proceed.
   * @returns {{ canProceed: boolean, errors: string[], warnings: string[] }}
   */
  async validateCanRecreateConfiguration() {
    const errors = [];
    const warnings = [];

    try {
      // Check project root is writable
      const testFile = path.join(this.projectRoot, '.setup-write-test');
      try {
        await fs.writeFile(testFile, '');
        await fs.remove(testFile);
      } catch (err) {
        errors.push(`Project root is not writable: ${err.message}`);
      }

      // Check we can create/write to src/config
      const configDir = path.join(this.projectRoot, 'src', 'config');
      try {
        await fs.ensureDir(configDir);
        const testConfig = path.join(configDir, '.setup-write-test');
        await fs.writeFile(testConfig, '');
        await fs.remove(testConfig);
      } catch (err) {
        errors.push(`Cannot create or write to src/config: ${err.message}`);
      }

      // Check package.json exists (project root)
      const packageJsonPath = path.join(this.projectRoot, 'package.json');
      if (!(await fs.pathExists(packageJsonPath))) {
        errors.push('package.json not found. Please run setup from the project root.');
      }
    } catch (err) {
      errors.push(`Validation failed: ${err.message}`);
    }

    const canProceed = errors.length === 0;
    return { canProceed, errors, warnings };
  }

  /**
   * Check if config.json or docker-compose.yml already exist.
   * @returns {{ hasConfigJson: boolean, hasDockerCompose: boolean, configPath: string, dockerComposePath: string }}
   */
  async checkExistingConfigAndDocker() {
    const hasConfigJson = await fs.pathExists(this.configJsonPath);
    const hasDockerCompose = await fs.pathExists(this.dockerComposePath);
    return {
      hasConfigJson,
      hasDockerCompose,
      configPath: this.configJsonPath,
      dockerComposePath: this.dockerComposePath,
    };
  }

  /**
   * Backup and remove existing config.json after user confirmation.
   * @returns {Promise<boolean>} true if cleared or did not exist
   */
  async backupAndRemoveConfigJson() {
    try {
      if (!(await fs.pathExists(this.configJsonPath))) {
        return true;
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const backupPath = path.join(
        path.dirname(this.configJsonPath),
        `config.json.backup.${timestamp}`,
      );
      await fs.copy(this.configJsonPath, backupPath);
      await fs.remove(this.configJsonPath);
      console.log(
        chalk.yellow(`⚠ Backed up config.json to ${path.basename(backupPath)} and removed.`),
      );
      return true;
    } catch (err) {
      console.error(chalk.red('✗ Failed to backup/remove config.json:'), err.message);
      return false;
    }
  }

  /**
   * Backup and remove existing docker-compose.yml (uses same path as DockerHelper).
   * @returns {Promise<boolean>} true if cleared or did not exist
   */
  async backupAndRemoveDockerCompose() {
    try {
      if (!(await fs.pathExists(this.dockerComposePath))) {
        return true;
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const backupPath = path.join(this.projectRoot, `docker-compose.yml.backup.${timestamp}`);
      await fs.copy(this.dockerComposePath, backupPath);
      await fs.remove(this.dockerComposePath);
      console.log(
        chalk.yellow(
          `⚠ Backed up docker-compose.yml to ${path.basename(backupPath)} and removed.`,
        ),
      );
      return true;
    } catch (err) {
      console.error(chalk.red('✗ Failed to backup/remove docker-compose.yml:'), err.message);
      return false;
    }
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
      envContent += `ALLOWED_WORKSPACE=${config.workspace || 'yourworkspace'}\n\n`;

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
    console.log(`  Workspace: ${config.workspace || 'yourworkspace'}`);
    console.log(`  User: ${config.bitbucketUser || 'Not set'}`);
    console.log(`  Email: ${config.bitbucketUserEmail || 'Not set'}`);
    console.log(`  Token: ${config.bitbucketToken ? '✓ Set' : '✗ Not set'}`);

    console.log(chalk.yellow('\nServer Configuration:'));
    console.log(`  Port: ${config.port || 3000}`);
    console.log(`  Process Only Created: ${config.processOnlyCreated ? 'Yes' : 'No'}`);
    console.log(`  Non-Allowed Users: ${config.nonAllowedUsers || 'None (all users allowed)'}`);
    console.log(`  Webhook Secret: ${config.webhookSecret ? '✓ Set' : '✗ Not set'}`);

    console.log(chalk.yellow('\nPrompt logs:'));
    console.log(`  Enabled: ${config.promptLogsEnabled ? 'Yes' : 'No'}`);

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
      path.join(this.projectRoot, 'src', 'config'),
    ];

    for (const dir of directories) {
      await fs.ensureDir(dir);
    }

    console.log(chalk.green('✓ Created necessary directories'));
  }

  /**
   * Default app config (templates + branch rules + server, claude, etc.). Used when creating or migrating to config.json.
   */
  getDefaultAppConfig() {
    return {
      defaultTemplate: 'default',
      repositories: {},
      prReview: {
        enabled: true,
        targetBranchPatterns: [],
        sourceBranchPatterns: [],
      },
      releaseNote: {
        enabled: false,
        targetBranchPatterns: ['^release-'],
        sourceBranchPatterns: [],
      },
      server: {
        port: 3000,
      },
      claude: {
        model: 'sonnet',
        timeoutMinutes: 10,
        maxDiffSizeKb: 200,
      },
      bitbucket: {
        allowedWorkspace: 'yourworkspace',
        nonAllowedUsers: '',
      },
      eventFilter: {
        processOnlyCreated: false,
      },
      metrics: {
        persistence: {
          enabled: false,
          type: 'filesystem',
          path: '/app/metrics-storage',
          saveIntervalMs: 30000,
        },
      },
      logging: {
        level: 'info',
        fileRetentionDays: 30,
        maxFileSize: '20m',
        enableConsole: true,
        enableFile: true,
      },
      circuitBreaker: {
        failureThreshold: 3,
        resetTimeoutMs: 30000,
      },
      promptLogs: {
        enabled: false,
        path: '/app/prompt-logs',
      },
    };
  }

  /**
   * Deep-merge defaults into config: for each key in defaults, set config[key] if missing or undefined.
   * Nested objects are merged recursively. Does not mutate defaults.
   */
  mergeConfigWithDefaults(config, defaults) {
    const result = { ...config };
    for (const key of Object.keys(defaults)) {
      const defaultVal = defaults[key];
      const currentVal = result[key];
      if (currentVal === undefined || currentVal === null) {
        result[key] =
          defaultVal && typeof defaultVal === 'object' && !Array.isArray(defaultVal)
            ? JSON.parse(JSON.stringify(defaultVal))
            : defaultVal;
      } else if (
        defaultVal &&
        typeof defaultVal === 'object' &&
        !Array.isArray(defaultVal) &&
        currentVal &&
        typeof currentVal === 'object' &&
        !Array.isArray(currentVal)
      ) {
        result[key] = this.mergeConfigWithDefaults(currentVal, defaultVal);
      }
    }
    return result;
  }

  /**
   * Create or migrate to src/config/config.json. If template-config.json exists, migrate from it.
   * Else if config.json exists, load and merge defaults. Else if config.json.example exists, use
   * it as template and merge defaults; otherwise use getDefaultAppConfig(). Optional overrides
   * (e.g. { promptLogs: { enabled: true } }) are merged in before writing. Writes config.json
   * (gitignored); config.json.example is the committed template.
   * @param {Object} [overrides] - Optional overrides to merge into config (e.g. from setup wizard)
   */
  async createOrMigrateConfigJson(overrides = {}) {
    const configDir = path.join(this.projectRoot, 'src', 'config');
    const configPath = path.join(configDir, 'config.json');
    const examplePath = path.join(configDir, 'config.json.example');
    const legacyPath = path.join(configDir, 'template-config.json');

    await fs.ensureDir(configDir);

    let config;
    if (await fs.pathExists(legacyPath)) {
      try {
        const legacy = await fs.readJSON(legacyPath);
        config = {
          defaultTemplate: legacy.defaultTemplate ?? 'default',
          repositories: legacy.repositories ?? {},
          prReview: legacy.prReview ?? this.getDefaultAppConfig().prReview,
          releaseNote: legacy.releaseNote ?? this.getDefaultAppConfig().releaseNote,
        };
        const backupPath = path.join(configDir, 'template-config.json.backup');
        await fs.copy(legacyPath, backupPath);
        console.log(
          chalk.yellow(
            '⚠ Migrated template-config.json to config.json (backup: template-config.json.backup)',
          ),
        );
      } catch (err) {
        console.error(chalk.red('✗ Failed to read template-config.json:'), err.message);
        config = this.getDefaultAppConfig();
      }
    } else if (await fs.pathExists(configPath)) {
      try {
        const loaded = await fs.readJSON(configPath);
        config = this.mergeConfigWithDefaults(loaded, this.getDefaultAppConfig());
      } catch (err) {
        console.error(chalk.red('✗ Failed to read config.json:'), err.message);
        config = this.getDefaultAppConfig();
      }
    } else if (await fs.pathExists(examplePath)) {
      try {
        const loaded = await fs.readJSON(examplePath);
        config = this.mergeConfigWithDefaults(loaded, this.getDefaultAppConfig());
      } catch (err) {
        console.error(chalk.red('✗ Failed to read config.json.example:'), err.message);
        config = this.getDefaultAppConfig();
      }
    } else {
      config = this.getDefaultAppConfig();
    }

    // Apply wizard/setup overrides (e.g. promptLogs.enabled)
    for (const key of Object.keys(overrides)) {
      if (overrides[key] && typeof overrides[key] === 'object' && !Array.isArray(overrides[key])) {
        config[key] = { ...(config[key] || {}), ...overrides[key] };
      }
    }

    const configExistedBefore = await fs.pathExists(configPath);
    await fs.writeJSON(configPath, config, { spaces: 2 });
    console.log(
      chalk.green(
        `✓ config.json ${configExistedBefore ? 'updated' : 'created'}: ${path.resolve(configPath)}`,
      ),
    );
    return configPath;
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
