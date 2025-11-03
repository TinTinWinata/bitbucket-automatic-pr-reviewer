const { exec } = require('child_process');
const { promisify } = require('util');
const chalk = require('chalk');
const fs = require('fs-extra');
const path = require('path');

const execAsync = promisify(exec);

class DockerHelper {
  constructor() {
    this.projectRoot = process.cwd();
    this.dockerComposePath = path.join(this.projectRoot, 'docker-compose.yml');
  }

  /**
   * Check if Docker and Docker Compose are installed and running
   */
  async checkDockerInstallation() {
    try {
      // Check Docker
      const { stdout: dockerVersion } = await execAsync('docker --version', { timeout: 10000 });
      console.log(chalk.green(`✓ Docker installed: ${dockerVersion.trim()}`));

      // Check Docker Compose
      const { stdout: composeVersion } = await execAsync('docker-compose --version', {
        timeout: 10000,
      });
      console.log(chalk.green(`✓ Docker Compose installed: ${composeVersion.trim()}`));

      // Check if Docker daemon is running
      await execAsync('docker info', { timeout: 10000 });
      console.log(chalk.green('✓ Docker daemon is running'));

      return true;
    } catch (error) {
      console.error(chalk.red('✗ Docker installation check failed:'), error.message);
      return false;
    }
  }

  /**
   * Check if docker-compose.yml exists
   */
  async checkDockerComposeFile() {
    return await fs.pathExists(this.dockerComposePath);
  }

  /**
   * Create docker-compose.yml from example if it doesn't exist
   */
  async createDockerComposeFile() {
    try {
      if (await this.checkDockerComposeFile()) {
        console.log(chalk.yellow('⚠ docker-compose.yml already exists'));
        return true;
      }

      const dockerComposeContent = `
services:
  pr-automation:
    build: .
    container_name: pr-automation
    restart: always
    user: node
    ports:
      - 3000:3000
    environment:
      - PORT=3000
      - CLAUDE_MODEL=\${CLAUDE_MODEL:-sonnet}
      - BITBUCKET_TOKEN=\${BITBUCKET_TOKEN}
      - BITBUCKET_USER=\${BITBUCKET_USER}
      - BITBUCKET_PASSWORD=\${BITBUCKET_PASSWORD}
      - BITBUCKET_WEBHOOK_SECRET=\${BITBUCKET_WEBHOOK_SECRET}
      - ALLOWED_WORKSPACE=\${ALLOWED_WORKSPACE:-xriopteam}
      - PROCESS_ONLY_CREATED=\${PROCESS_ONLY_CREATED:-false}
      - METRICS_PERSISTENCE_ENABLED=\${METRICS_PERSISTENCE_ENABLED:-false}
      - METRICS_PERSISTENCE_TYPE=\${METRICS_PERSISTENCE_TYPE:-filesystem}
      - METRICS_PERSISTENCE_PATH=\${METRICS_PERSISTENCE_PATH:-/app/metrics-storage}
      - METRICS_PERSISTENCE_SAVE_INTERVAL_MS=\${METRICS_PERSISTENCE_SAVE_INTERVAL_MS:-30000}
      - SHELL=/bin/bash
    env_file:
      - .env
    volumes:
      - ./src:/app/src
      - ./logs:/app/logs
      - ./projects:/app/projects
      - ./metrics-storage:/app/metrics-storage
      - ./.mcp.json:/app/.mcp.json
      - ./claude-config/.claude.json:/home/node/.claude.json
      - ./claude-config/.claude:/home/node/.claude
`;

      await fs.writeFile(this.dockerComposePath, dockerComposeContent.trim());
      console.log(chalk.green('✓ Created docker-compose.yml'));
      return true;
    } catch (error) {
      console.error(chalk.red('✗ Failed to create docker-compose.yml:'), error.message);
      return false;
    }
  }

  /**
   * Build Docker image
   */
  async buildDockerImage() {
    try {
      console.log(chalk.blue('🐳 Building Docker image...'));

      const { stderr } = await execAsync('docker-compose build', {
        cwd: this.projectRoot,
        timeout: 300000, // 5 minutes timeout
      });

      if (stderr && !stderr.includes('warning')) {
        console.log(chalk.yellow('Build output:'), stderr);
      }

      console.log(chalk.green('✓ Docker image built successfully'));
      return true;
    } catch (error) {
      console.error(chalk.red('✗ Docker build failed:'), error.message);

      // Provide specific suggestions based on error type
      if (error.message.includes('npm install')) {
        if (error.message.includes('husky') || error.message.includes('prepare')) {
          console.log(chalk.yellow('\n💡 Docker build failed due to husky/git hooks issue.'));
          console.log(chalk.gray('The Dockerfile has been updated to fix this issue.'));
          console.log(chalk.cyan('\nSolution: Try rebuilding without cache:'));
          console.log(chalk.gray('   docker-compose build --no-cache'));
        } else {
          console.log(chalk.yellow('\n💡 Docker npm install failed. Possible solutions:'));
          console.log(
            chalk.gray('1. Try rebuilding without cache: docker-compose build --no-cache'),
          );
          console.log(chalk.gray('2. Check if package.json has valid syntax'));
          console.log(chalk.gray('3. Try: npm run build:local (build without Docker)'));
        }
      } else if (error.message.includes('timeout')) {
        console.log(chalk.yellow('\n💡 Build timed out. Try:'));
        console.log(chalk.gray('1. Increase timeout in docker settings'));
        console.log(chalk.gray('2. Free up disk space'));
        console.log(chalk.gray('3. Try: docker system prune -f'));
      } else if (error.message.includes('permission denied')) {
        console.log(chalk.yellow('\n💡 Permission denied. Try:'));
        console.log(chalk.gray('1. Restart Docker daemon'));
        console.log(chalk.gray('2. Check Docker permissions'));
      }

      return false;
    }
  }

  /**
   * Start Docker services
   */
  async startServices() {
    try {
      console.log(chalk.blue('🚀 Starting Docker services...'));

      await execAsync('docker-compose up -d', {
        cwd: this.projectRoot,
        timeout: 60000, // 1 minute timeout
      });

      console.log(chalk.green('✓ Docker services started'));
      return true;
    } catch (error) {
      console.error(chalk.red('✗ Failed to start Docker services:'), error.message);
      return false;
    }
  }

  /**
   * Check if services are running and healthy
   */
  async checkServiceHealth() {
    try {
      console.log(chalk.blue('🔍 Checking service health...'));

      // Check if container is running
      const { stdout: psOutput } = await execAsync('docker-compose ps', {
        cwd: this.projectRoot,
        timeout: 15000,
      });

      if (psOutput.includes('Up')) {
        console.log(chalk.green('✓ Service is running'));
      } else {
        console.log(chalk.yellow('⚠ Service may not be fully started yet'));
      }

      // Wait a moment and then check health endpoint
      await new Promise(resolve => setTimeout(resolve, 5000));

      try {
        const { stdout: healthOutput } = await execAsync('curl -f http://localhost:3000/health', {
          timeout: 10000,
        });

        if (healthOutput.includes('ok')) {
          console.log(chalk.green('✓ Health check passed'));
          return true;
        }
      } catch (healthError) {
        console.log(
          chalk.yellow(
            `⚠ Health check failed, but service may still be starting ${healthError.message}`,
          ),
        );
        console.log(
          chalk.gray('   You can check manually with: curl http://localhost:3000/health'),
        );
      }

      return true;
    } catch (error) {
      console.error(chalk.red('✗ Service health check failed:'), error.message);
      return false;
    }
  }

  /**
   * Show Docker status and logs
   */
  async showServiceStatus() {
    try {
      console.log(chalk.cyan('\n📊 Docker Service Status:'));

      // Show container status
      const { stdout: psOutput } = await execAsync('docker-compose ps', {
        cwd: this.projectRoot,
        timeout: 15000,
      });
      console.log(chalk.cyan(psOutput));

      // Show recent logs
      console.log(chalk.cyan('\n📝 Recent Logs:'));
      const { stdout: logsOutput } = await execAsync('docker-compose logs --tail=20', {
        cwd: this.projectRoot,
        timeout: 15000,
      });
      console.log(chalk.gray(logsOutput));
    } catch (error) {
      console.error(chalk.red('✗ Failed to get service status:'), error.message);
    }
  }

  /**
   * Stop Docker services
   */
  async stopServices() {
    try {
      console.log(chalk.blue('🛑 Stopping Docker services...'));

      await execAsync('docker-compose down', {
        cwd: this.projectRoot,
        timeout: 60000,
      });

      console.log(chalk.green('✓ Docker services stopped'));
      return true;
    } catch (error) {
      console.error(chalk.red('✗ Failed to stop Docker services:'), error.message);
      return false;
    }
  }

  /**
   * Handle Docker build failure and offer alternatives
   */
  async handleBuildFailure() {
    const inquirer = require('inquirer');

    console.log(chalk.yellow('\n🤔 Docker build failed. Would you like to:'));

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'Choose an alternative:',
        choices: [
          {
            name: '🔄 Try rebuilding without cache',
            value: 'rebuild',
          },
          {
            name: '💻 Run locally without Docker',
            value: 'local',
          },
          {
            name: '❌ Skip Docker setup (configure manually later)',
            value: 'skip',
          },
          {
            name: '🔧 Troubleshoot Docker issues',
            value: 'troubleshoot',
          },
        ],
      },
    ]);

    switch (action) {
      case 'rebuild':
        console.log(chalk.blue('🔄 Rebuilding Docker image without cache...'));
        try {
          await execAsync('docker-compose build --no-cache', {
            cwd: this.projectRoot,
            timeout: 300000,
          });
          console.log(chalk.green('✓ Docker image rebuilt successfully'));
          return { success: true, action: 'rebuild' };
        } catch (error) {
          console.error(chalk.red('✗ Rebuild failed:'), error.message);
          return await this.handleBuildFailure();
        }

      case 'local':
        console.log(chalk.blue('💻 Setting up local development...'));
        console.log(chalk.cyan('\nTo run locally:'));
        console.log(chalk.gray('1. Make sure you have Node.js installed'));
        console.log(chalk.gray('2. Install Claude CLI: npm install -g @anthropic-ai/claude-code'));
        console.log(chalk.gray('3. Run: npm run build:local'));
        console.log(chalk.gray('4. Set up your Claude configuration in ~/.claude.json'));
        console.log(chalk.gray('5. Run: npm start'));
        console.log(chalk.cyan('\nYour .env file is already configured!'));
        return { success: true, action: 'local' };

      case 'skip':
        console.log(chalk.yellow('⚠ Skipping Docker setup'));
        console.log(chalk.cyan('\nYou can run Docker manually later:'));
        console.log(chalk.gray('docker-compose build'));
        console.log(chalk.gray('docker-compose up -d'));
        return { success: false, action: 'skip' };

      case 'troubleshoot':
        this.showTroubleshootingGuide();
        return await this.handleBuildFailure();

      default:
        return { success: false, action: 'unknown' };
    }
  }

  /**
   * Show troubleshooting guide
   */
  showTroubleshootingGuide() {
    console.log(chalk.cyan('\n🔧 Docker Troubleshooting Guide:'));
    console.log(chalk.yellow('\n1. Clear Docker cache:'));
    console.log(chalk.gray('   docker system prune -f'));
    console.log(chalk.gray('   docker builder prune -f'));

    console.log(chalk.yellow('\n2. Check Docker status:'));
    console.log(chalk.gray('   docker version'));
    console.log(chalk.gray('   docker info'));

    console.log(chalk.yellow('\n3. Restart Docker:'));
    console.log(chalk.gray('   macOS/Windows: Restart Docker Desktop'));
    console.log(chalk.gray('   Linux: sudo systemctl restart docker'));

    console.log(chalk.yellow('\n4. Free up disk space:'));
    console.log(chalk.gray('   docker system df'));
    console.log(chalk.gray('   docker volume prune -f'));

    console.log(chalk.yellow('\n5. Check for conflicting containers:'));
    console.log(chalk.gray('   docker ps -a'));
    console.log(chalk.gray('   docker-compose down'));
  }

  /**
   * Show useful Docker commands to the user
   */
  showDockerCommands() {
    console.log(chalk.cyan('\n🐳 Useful Docker Commands:'));
    console.log(chalk.gray('View logs:        docker-compose logs -f'));
    console.log(chalk.gray('Check status:     docker-compose ps'));
    console.log(chalk.gray('Restart services: docker-compose restart'));
    console.log(chalk.gray('Stop services:    docker-compose down'));
    console.log(chalk.gray('Rebuild image:    docker-compose build --no-cache'));
    console.log(chalk.gray('Execute shell:    docker-compose exec pr-automation sh'));
  }

  /**
   * Handle common Docker issues and provide solutions
   */
  handleDockerIssues(error) {
    const solutions = {
      'permission denied': 'Try running: sudo usermod -aG docker $USER && newgrp docker',
      'port is already allocated':
        'Try stopping other services on port 3000 or change the port in .env',
      'image not found': 'Try running: docker-compose build --no-cache',
      'connection refused': 'Make sure Docker daemon is running: sudo systemctl start docker',
      timeout: 'The build is taking too long. Try: docker-compose build --no-cache',
    };

    for (const [issue, solution] of Object.entries(solutions)) {
      if (error.message.toLowerCase().includes(issue)) {
        console.log(chalk.yellow(`\n💡 Possible solution: ${solution}`));
        break;
      }
    }
  }
}

module.exports = DockerHelper;
