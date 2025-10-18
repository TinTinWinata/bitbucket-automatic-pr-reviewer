#!/usr/bin/env node

const inquirer = require('inquirer');
const chalk = require('chalk');
const fs = require('fs-extra');
const path = require('path');

const ClaudeAuthHandler = require('./src/setup/claude-auth');
const ConfigGenerator = require('./src/setup/config-generator');
const DockerHelper = require('./src/setup/docker-helper');

class SetupWizard {
  constructor() {
    this.claudeAuth = new ClaudeAuthHandler();
    this.configGenerator = new ConfigGenerator();
    this.dockerHelper = new DockerHelper();
    this.config = {};
  }

  /**
   * Display welcome banner
   */
  showWelcome() {
    console.log(
      chalk.cyan(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║           🚀 PR Automation Setup Wizard 🚀                   ║
║                                                              ║
║     This wizard will guide you through setting up the        ║
║   Bitbucket PR automation service with Claude CLI            ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`),
    );
  }

  /**
   * Check prerequisites
   */
  async checkPrerequisites() {
    console.log(chalk.blue('\n🔍 Checking prerequisites...'));

    // Check Node.js version
    const nodeVersion = process.version;
    console.log(chalk.green(`✓ Node.js version: ${nodeVersion}`));

    // Check if we're in the right directory
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    if (!(await fs.pathExists(packageJsonPath))) {
      console.error(chalk.red('✗ package.json not found. Please run this from the project root.'));
      process.exit(1);
    }
    console.log(chalk.green('✓ Project directory validated'));

    // Check Claude CLI installation
    const claudeInstalled = await this.claudeAuth.checkClaudeInstallation();
    if (!claudeInstalled) {
      console.log(chalk.yellow('⚠ Claude CLI not found. You can install it with:'));
      console.log(chalk.gray('   npm install -g @anthropic-ai/claude-code'));

      const { continueWithoutClaude } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'continueWithoutClaude',
          message: 'Continue without Claude CLI installed?',
          default: false,
        },
      ]);

      if (!continueWithoutClaude) {
        console.log(chalk.blue('Please install Claude CLI and run the setup again.'));
        process.exit(0);
      }
    } else {
      console.log(chalk.green('✓ Claude CLI is installed'));
    }

    // Check Docker installation
    const dockerOk = await this.dockerHelper.checkDockerInstallation();
    if (!dockerOk) {
      console.log(chalk.yellow('⚠ Docker is not properly installed or running.'));
      console.log(chalk.gray('   Please install Docker and ensure the daemon is running.'));

      const { continueWithoutDocker } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'continueWithoutDocker',
          message: 'Continue setup without Docker? (You can run it manually later)',
          default: false,
        },
      ]);

      if (!continueWithoutDocker) {
        console.log(chalk.blue('Please install Docker and run the setup again.'));
        process.exit(0);
      }
    }

    console.log(chalk.green('✓ Prerequisites check completed\n'));
  }

  /**
   * Setup Claude authentication
   */
  async setupClaudeAuth() {
    console.log(chalk.blue('🤖 Setting up Claude authentication...'));

    const existingConfig = await this.claudeAuth.checkExistingClaudeConfig();

    if (existingConfig.hasConfig || existingConfig.hasDir) {
      console.log(chalk.yellow(`\n📁 Found existing Claude configuration:`));
      if (existingConfig.hasConfig) {
        console.log(chalk.gray(`   • Config: ${existingConfig.configPath}`));
      }
      if (existingConfig.hasDir) {
        console.log(chalk.gray(`   • Session data: ${existingConfig.dirPath}`));
      }

      const { useExisting } = await inquirer.prompt([
        {
          type: 'list',
          name: 'useExisting',
          message: 'How would you like to proceed?',
          choices: [
            {
              name: '🔄 Use existing Claude configuration (recommended)',
              value: 'use_existing',
            },
            {
              name: '🔑 Set up new API key authentication',
              value: 'new_api',
            },
            {
              name: '🤖 Set up GLM model authentication',
              value: 'new_glm',
            },
            {
              name: '🆕 Start fresh (remove existing config)',
              value: 'fresh_start',
            },
          ],
          default: 'use_existing',
        },
      ]);

      if (useExisting === 'use_existing') {
        this.config.authMethod = 'session';
        this.config.claudeProvider = 'claude';
        const success = await this.claudeAuth.copyExistingClaudeConfig();
        if (!success) {
          throw new Error('Failed to copy existing Claude configuration');
        }

        // Ask for model selection even when using existing config
        const availableModels = this.claudeAuth.getAvailableModels().claude;
        const { model } = await inquirer.prompt([
          {
            type: 'list',
            name: 'model',
            message: 'Choose Claude model:',
            choices: availableModels,
            default: 'sonnet',
          },
        ]);

        this.config.claudeModel = model;
        return;
      } else if (useExisting === 'new_api') {
        // Set up for API key authentication
        this.config.authMethod = 'api';
        this.config.claudeProvider = 'claude';
        await this.setupAPIKeyAuth();
        return;
      } else if (useExisting === 'new_glm') {
        // Set up for GLM authentication
        this.config.authMethod = 'glm';
        this.config.claudeProvider = 'glm';
        await this.setupGLMAuth();
        return;
      } else if (useExisting === 'fresh_start') {
        // Remove existing config and start fresh
        console.log(chalk.yellow('🗑️  Removing existing Claude configuration...'));
        const fs = require('fs-extra');
        const claudeConfigDir = path.join(process.cwd(), 'claude-config');

        if (await fs.pathExists(claudeConfigDir)) {
          await fs.remove(claudeConfigDir);
          console.log(chalk.green('✓ Removed existing Claude configuration'));
        }

        // Continue to normal authentication method selection
      }
    }

    const { method } = await inquirer.prompt([
      {
        type: 'list',
        name: 'method',
        message: 'Choose Claude authentication method:',
        choices: [
          {
            name: '🔄 Session-based (use existing Claude login)',
            value: 'session',
          },
          {
            name: '🔑 API Key (use Anthropic API)',
            value: 'api',
          },
          {
            name: '🤖 GLM Model (use Chinese AI model)',
            value: 'glm',
          },
        ],
      },
    ]);

    this.config.authMethod = method;
    this.config.claudeProvider = method === 'glm' ? 'glm' : 'claude';

    // Show instructions
    this.claudeAuth.showAuthInstructions(method);

    if (method === 'session') {
      const success = await this.claudeAuth.copyExistingClaudeConfig();
      if (!success) {
        throw new Error('Failed to copy Claude configuration');
      }

      // Ask for model selection even with session-based auth
      const availableModels = this.claudeAuth.getAvailableModels().claude;
      const { model } = await inquirer.prompt([
        {
          type: 'list',
          name: 'model',
          message: 'Choose Claude model:',
          choices: availableModels,
          default: 'sonnet',
        },
      ]);

      this.config.claudeModel = model;
    } else if (method === 'api') {
      const { apiKey } = await inquirer.prompt([
        {
          type: 'password',
          name: 'apiKey',
          message: 'Enter your Anthropic API key:',
          validate: input => input.trim().length > 0 || 'API key is required',
        },
      ]);

      const availableModels = this.claudeAuth.getAvailableModels().claude;
      const { model } = await inquirer.prompt([
        {
          type: 'list',
          name: 'model',
          message: 'Choose Claude model:',
          choices: availableModels,
          default: 'sonnet',
        },
      ]);

      const success = await this.claudeAuth.generateClaudeConfigFromAPI(apiKey, model);
      if (!success) {
        throw new Error('Failed to generate Claude configuration');
      }

      this.config.claudeModel = model;
    } else if (method === 'glm') {
      const { apiKey } = await inquirer.prompt([
        {
          type: 'password',
          name: 'apiKey',
          message: 'Enter your GLM API key:',
          validate: input => input.trim().length > 0 || 'API key is required',
        },
      ]);

      const availableModels = this.claudeAuth.getAvailableModels().glm;
      const { model } = await inquirer.prompt([
        {
          type: 'list',
          name: 'model',
          message: 'Choose GLM model:',
          choices: availableModels,
          default: 'glm-4.6',
        },
      ]);

      const success = await this.claudeAuth.generateGLMConfig(apiKey, model);
      if (!success) {
        throw new Error('Failed to generate GLM configuration');
      }

      this.config.claudeModel = model;
    }
  }

  /**
   * Setup API Key authentication
   */
  async setupAPIKeyAuth() {
    this.claudeAuth.showAuthInstructions('api');

    const { apiKey } = await inquirer.prompt([
      {
        type: 'password',
        name: 'apiKey',
        message: 'Enter your Anthropic API key:',
        validate: input => input.trim().length > 0 || 'API key is required',
      },
    ]);

    const availableModels = this.claudeAuth.getAvailableModels().claude;
    const { model } = await inquirer.prompt([
      {
        type: 'list',
        name: 'model',
        message: 'Choose Claude model:',
        choices: availableModels,
        default: 'sonnet',
      },
    ]);

    const success = await this.claudeAuth.generateClaudeConfigFromAPI(apiKey, model);
    if (!success) {
      throw new Error('Failed to generate Claude configuration');
    }

    this.config.claudeModel = model;
  }

  /**
   * Setup GLM authentication
   */
  async setupGLMAuth() {
    this.claudeAuth.showAuthInstructions('glm');

    const { apiKey } = await inquirer.prompt([
      {
        type: 'password',
        name: 'apiKey',
        message: 'Enter your GLM API key:',
        validate: input => input.trim().length > 0 || 'API key is required',
      },
    ]);

    const availableModels = this.claudeAuth.getAvailableModels().glm;
    const { model } = await inquirer.prompt([
      {
        type: 'list',
        name: 'model',
        message: 'Choose GLM model:',
        choices: availableModels,
        default: 'glm-4.6',
      },
    ]);

    const success = await this.claudeAuth.generateGLMConfig(apiKey, model);
    if (!success) {
      throw new Error('Failed to generate GLM configuration');
    }

    this.config.claudeModel = model;
  }

  /**
   * Setup Bitbucket configuration
   */
  async setupBitbucketConfig() {
    console.log(chalk.blue('\n🔧 Setting up Bitbucket configuration...'));

    const { authMethod } = await inquirer.prompt([
      {
        type: 'list',
        name: 'authMethod',
        message: 'Choose Bitbucket authentication method:',
        choices: [
          {
            name: '🎫 App Password (recommended)',
            value: 'token',
          },
          {
            name: '👤 Username + Password',
            value: 'credentials',
          },
        ],
      },
    ]);

    if (authMethod === 'token') {
      console.log(
        chalk.cyan(`
To create a Bitbucket App Password:
1. Go to Bitbucket → Personal Settings → App passwords
2. Click "Create app password"
3. Name: "PR Automation"
4. Permissions: Select "Repositories: Read" and "Pull requests: Read"
5. Copy the generated password
`),
      );

      const { token } = await inquirer.prompt([
        {
          type: 'password',
          name: 'token',
          message: 'Enter your Bitbucket App Password:',
          validate: input => input.trim().length > 0 || 'App Password is required',
        },
      ]);

      this.config.bitbucketToken = token;
    } else {
      const { user, password } = await inquirer.prompt([
        {
          type: 'input',
          name: 'user',
          message: 'Enter your Bitbucket username:',
          validate: input => input.trim().length > 0 || 'Username is required',
        },
        {
          type: 'password',
          name: 'password',
          message: 'Enter your Bitbucket password:',
          validate: input => input.trim().length > 0 || 'Password is required',
        },
      ]);

      this.config.bitbucketUser = user;
      this.config.bitbucketPassword = password;
      this.config.bitbucketToken = ''; // Clear token if using credentials
    }

    const { workspace } = await inquirer.prompt([
      {
        type: 'input',
        name: 'workspace',
        message: 'Enter your Bitbucket workspace name:',
        default: 'xriopteam',
        validate: input => input.trim().length > 0 || 'Workspace is required',
      },
    ]);

    this.config.workspace = workspace.trim();
  }

  /**
   * Setup server and webhook configuration
   */
  async setupServerConfig() {
    console.log(chalk.blue('\n⚙️  Setting up server configuration...'));

    const { port } = await inquirer.prompt([
      {
        type: 'number',
        name: 'port',
        message: 'Enter server port:',
        default: 3000,
        validate: input => (input >= 1 && input <= 65535) || 'Port must be between 1 and 65535',
      },
    ]);

    this.config.port = port;

    const { processOnlyCreated } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'processOnlyCreated',
        message: 'Only process PR creation events (ignore updates)?',
        default: false,
      },
    ]);

    this.config.processOnlyCreated = processOnlyCreated;

    const { useWebhookSecret } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'useWebhookSecret',
        message: 'Use webhook signature validation (recommended for security)?',
        default: true,
      },
    ]);

    if (useWebhookSecret) {
      const { generateSecret } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'generateSecret',
          message: 'Generate a random webhook secret?',
          default: true,
        },
      ]);

      if (generateSecret) {
        this.config.webhookSecret = this.claudeAuth.generateWebhookSecret();
        console.log(chalk.green(`✓ Generated webhook secret: ${this.config.webhookSecret}`));
      } else {
        const { secret } = await inquirer.prompt([
          {
            type: 'password',
            name: 'secret',
            message: 'Enter webhook secret:',
            validate: input => input.trim().length > 0 || 'Webhook secret is required',
          },
        ]);
        this.config.webhookSecret = secret;
      }
    } else {
      this.config.webhookSecret = '';
    }
  }

  /**
   * Review and confirm configuration
   */
  async reviewConfiguration() {
    console.log(chalk.blue('\n📋 Configuration Review'));
    this.configGenerator.showConfigurationPreview(this.config);

    const validation = this.configGenerator.validateConfiguration(this.config);
    if (!validation.isValid) {
      console.error(chalk.red('\n❌ Configuration validation failed:'));
      validation.errors.forEach(error => console.error(chalk.red(`   • ${error}`)));
      throw new Error('Configuration validation failed');
    }

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Does this configuration look correct?',
        default: true,
      },
    ]);

    if (!confirm) {
      throw new Error('Configuration cancelled by user');
    }
  }

  /**
   * Generate configuration files
   */
  async generateConfigFiles() {
    console.log(chalk.blue('\n📝 Generating configuration files...'));

    // Backup existing .env if it exists
    await this.configGenerator.backupExistingEnv();

    // Create necessary directories
    await this.configGenerator.createDirectories();

    // Generate .env file
    const envSuccess = await this.configGenerator.generateEnvFile(this.config);
    if (!envSuccess) {
      throw new Error('Failed to generate .env file');
    }

    // Generate .mcp.json
    const mcpSuccess = await this.configGenerator.generateMcpConfig(this.config);
    if (!mcpSuccess) {
      console.log(chalk.yellow('⚠ Warning: Failed to generate .mcp.json'));
    }

    console.log(chalk.green('✓ Configuration files generated'));
  }

  /**
   * Setup and start Docker services
   */
  async setupDocker() {
    console.log(chalk.blue('\n🐳 Setting up Docker services...'));

    // Create docker-compose.yml if needed
    await this.dockerHelper.createDockerComposeFile();

    const { buildAndStart } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'buildAndStart',
        message: 'Build and start Docker services now?',
        default: true,
      },
    ]);

    if (buildAndStart) {
      // Build Docker image
      const buildSuccess = await this.dockerHelper.buildDockerImage();
      if (!buildSuccess) {
        // Handle build failure with alternatives
        const failureResult = await this.dockerHelper.handleBuildFailure();
        if (!failureResult.success) {
          console.log(
            chalk.yellow('⚠ Docker setup skipped. You can configure it manually later.'),
          );
          this.dockerHelper.showDockerCommands();
          return;
        }

        if (failureResult.action === 'rebuild') {
          // Rebuild was successful, continue with starting services
          const startSuccess = await this.dockerHelper.startServices();
          if (!startSuccess) {
            console.log(
              chalk.yellow(
                '⚠ Failed to start Docker services. You can start them manually later.',
              ),
            );
            this.dockerHelper.showDockerCommands();
            return;
          }

          // Check service health
          await this.dockerHelper.checkServiceHealth();
          await this.dockerHelper.showServiceStatus();
        } else if (failureResult.action === 'local') {
          // Local development setup, skip Docker
          console.log(chalk.green('✓ Local development setup configured'));
          return;
        }
        // If action was 'skip', just continue without Docker
      } else {
        // Build was successful, continue with starting services
        const startSuccess = await this.dockerHelper.startServices();
        if (!startSuccess) {
          console.log(
            chalk.yellow('⚠ Failed to start Docker services. You can start them manually later.'),
          );
          this.dockerHelper.showDockerCommands();
          return;
        }

        // Check service health
        await this.dockerHelper.checkServiceHealth();
        await this.dockerHelper.showServiceStatus();
      }
    }

    this.dockerHelper.showDockerCommands();
  }

  /**
   * Show completion message
   */
  showCompletion() {
    console.log(
      chalk.green(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║           🎉 Setup Completed Successfully! 🎉               ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝

`),
    );

    console.log(chalk.cyan('Next Steps:'));
    console.log(chalk.gray('1. Configure your Bitbucket webhook:'));
    console.log(chalk.gray(`   URL: http://your-server:${this.config.port}/webhook/bitbucket/pr`));
    if (this.config.webhookSecret) {
      console.log(chalk.gray(`   Secret: ${this.config.webhookSecret}`));
    }
    console.log(chalk.gray('2. Test the service:'));
    console.log(chalk.gray(`   curl http://localhost:${this.config.port}/health`));
    console.log(chalk.gray('3. Check logs:'));
    console.log(chalk.gray('   docker-compose logs -f'));

    console.log(chalk.cyan('\n📚 Documentation:'));
    console.log(chalk.gray('• README.md - Complete usage guide'));
    console.log(chalk.gray('• WEBHOOK_SECURITY.md - Security configuration'));
    console.log(chalk.gray('• PROMETHEUS.md - Monitoring setup'));

    console.log(chalk.green('\n✨ Your PR automation service is ready to use!'));
  }

  /**
   * Main setup flow
   */
  async run() {
    try {
      this.showWelcome();
      await this.checkPrerequisites();
      await this.setupClaudeAuth();
      await this.setupBitbucketConfig();
      await this.setupServerConfig();
      await this.reviewConfiguration();
      await this.generateConfigFiles();
      await this.setupDocker();
      this.showCompletion();
    } catch (error) {
      console.error(chalk.red('\n❌ Setup failed:'), error.message);

      if (error.message.includes('Docker')) {
        this.dockerHelper.handleDockerIssues(error);
      }

      console.log(chalk.yellow('\n💡 You can re-run the setup at any time with: npm run setup'));
      process.exit(1);
    }
  }
}

// Run the setup wizard
if (require.main === module) {
  const wizard = new SetupWizard();
  wizard.run().catch(error => {
    console.error(chalk.red('Unexpected error:'), error);
    process.exit(1);
  });
}

module.exports = SetupWizard;
