const fs = require('fs');
const path = require('path');
const { ensureProjectExists, getDiffFromMergeBase } = require('./git');
const { metrics } = require('./metrics');
const TemplateManager = require('./template-manager');
const logger = require('./logger').default;
const { getConfig } = require('./config/loader');

/**
 * Normalize queue item or legacy prData to { prData, type }.
 * @param {Object} queueItemOrPrData - Either { prData, type } or plain prData (legacy)
 * @returns {{ prData: Object, type: string }}
 */
function normalizeQueueItem(queueItemOrPrData) {
  if (queueItemOrPrData && queueItemOrPrData.type && queueItemOrPrData.prData) {
    return { prData: queueItemOrPrData.prData, type: queueItemOrPrData.type };
  }
  return { prData: queueItemOrPrData, type: 'review' };
}

/**
 * Run only the release-note flow: ensure repo, build prompt, run Claude, post comment via MCP.
 * @param {Object} prData - Pull request data
 * @returns {Promise<{ success: boolean }>}
 */
async function runReleaseNoteFlow(prData) {
  logger.info('Running release note flow...');
  logger.info(`PR Title: ${prData.title}`);

  const repoData = {
    name: prData.repository,
    cloneUrl: prData.repoCloneUrl,
    sourceBranch: prData.sourceBranch,
  };
  const projectResult = await ensureProjectExists(repoData);
  if (!projectResult.success) {
    throw new Error('Failed to ensure project exists');
  }

  const templateManager = new TemplateManager();
  const prompt = templateManager.getReleaseNotePrompt(prData);
  const promptLogs = getConfig().promptLogs || {};
  const promptDir = promptLogs.enabled && promptLogs.path ? promptLogs.path : '/tmp';
  if (promptLogs.enabled && promptLogs.path) {
    fs.mkdirSync(promptDir, { recursive: true });
  }
  const promptFile = path.join(promptDir, `release-note-${Date.now()}.txt`);
  fs.writeFileSync(promptFile, prompt);

  const claudeConfig = getConfig().claude || {};
  const model = claudeConfig.model || 'sonnet';

  logger.info(`Running claude process with model selected: ${model}`);

  let timeoutMinutes = parseInt(claudeConfig.timeoutMinutes, 10);
  if (Number.isNaN(timeoutMinutes) || timeoutMinutes <= 0) timeoutMinutes = 10;

  const env = {
    ...process.env,
    SHELL: '/bin/bash',
    HOME: '/home/node',
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  };

  const { spawn } = require('child_process');
  const claudeProcess = spawn(
    'claude',
    ['--dangerously-skip-permissions', '--model', model, '--output-format', 'text'],
    { cwd: projectResult.path, env, shell: false },
  );

  try {
    const result = await new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      const timeoutMs = timeoutMinutes * 60 * 1000;
      const timeout = setTimeout(() => {
        claudeProcess.kill('SIGTERM');
        reject(new Error(`Release note generation timed out after ${timeoutMinutes} minutes`));
      }, timeoutMs);
      claudeProcess.stdout.on('data', d => {
        stdout += d.toString();
        process.stdout.write(d);
      });
      claudeProcess.stderr.on('data', d => {
        stderr += d.toString();
        process.stderr.write(d);
      });
      claudeProcess.on('close', code => {
        clearTimeout(timeout);
        if (code === 0) resolve({ stdout, stderr });
        else
          reject(new Error(`Claude exited with code ${code}: ${stderr || stdout || 'No output'}`));
      });
      claudeProcess.on('error', reject);
      claudeProcess.stdin.write(fs.readFileSync(promptFile, 'utf8'));
      claudeProcess.stdin.end();
    });
    logger.info('✓ Release note Claude run completed');
    return { success: true, response: result.stdout };
  } finally {
    if (!promptLogs.enabled && fs.existsSync(promptFile)) {
      fs.unlinkSync(promptFile);
    }
  }
}

/**
 * Process pull request with Claude (review or create-release-note by queue item type).
 * @param {Object} queueItemOrPrData - Either { prData, type: 'review'|'create-release-note' } or legacy prData
 */
async function processPullRequest(queueItemOrPrData) {
  const { prData, type } = normalizeQueueItem(queueItemOrPrData);
  const repository = prData.repository;
  const startTime = Date.now();

  if (type === 'create-release-note') {
    try {
      await runReleaseNoteFlow(prData);
      return { success: true };
    } catch (error) {
      logger.error(`Release note flow failed: ${error.message}`);
      throw error;
    }
  }

  try {
    logger.info('Processing PR with Claude (review)...');
    logger.info(`PR Title: ${prData.title}`);
    logger.info(`Author: ${prData.author}`);
    logger.info(`Repository: ${prData.repository}`);

    // STEP 1: Validate and ensure project is cloned
    logger.info('=== Step 1: Validating Project ===');
    const repoData = {
      name: prData.repository,
      cloneUrl: prData.repoCloneUrl,
      sourceBranch: prData.sourceBranch,
    };

    const projectResult = await ensureProjectExists(repoData);
    logger.debug(`Project validation result: ${JSON.stringify(projectResult)}`);

    if (!projectResult.success) {
      throw new Error('Failed to ensure project exists');
    }

    logger.info(`Project path: ${projectResult.path}`);
    logger.info(`Was cloned: ${projectResult.wasCloned ? 'Yes' : 'No (already existed)'}`);

    // STEP 2: Get diff from merge-base (only PR author's changes)
    logger.info('=== Step 2: Getting PR Diff from Merge-Base ===');
    let diffResult = null;
    let diffTooLarge = false;

    try {
      diffResult = await getDiffFromMergeBase(
        projectResult.path,
        prData.sourceBranch,
        prData.destinationBranch,
      );

      if (diffResult.success) {
        const maxDiffSizeKb = getConfig().claude.maxDiffSizeKb || 200;
        const maxDiffSizeBytes = maxDiffSizeKb * 1024;
        diffTooLarge = diffResult.size > maxDiffSizeBytes;
        const diffSizeKB = (diffResult.size / 1024).toFixed(2);
        const estimatedTokens = Math.round(diffResult.size / 4); // Rough estimate: 1 token ≈ 4 chars

        logger.info(
          `Diff retrieved: ${diffSizeKB} KB (~${estimatedTokens.toLocaleString()} tokens, limit: ${maxDiffSizeKb}KB)`,
        );
        logger.info(
          `Diff handling: ${diffTooLarge ? 'too large, will use merge-base instructions' : 'will include directly in prompt'}`,
        );
      }
    } catch (error) {
      logger.warn(`Failed to get diff from merge-base: ${error.message}. Will rely on MCP tools.`);
      // Continue without diff - Claude will use MCP tools
    }

    // STEP 3: Process with Claude CLI
    logger.info('=== Step 3: Processing with Claude CLI ===');

    const templateManager = new TemplateManager();
    const prompt = templateManager.getPromptForPR(prData, {
      diff: diffResult && !diffTooLarge ? diffResult.diff : null,
      diffTooLarge: diffTooLarge,
      sourceBranch: prData.sourceBranch,
      destinationBranch: prData.destinationBranch,
    });

    // Write prompt to file (persisted or temp per config)
    const promptLogs = getConfig().promptLogs || {};
    const promptDir = promptLogs.enabled && promptLogs.path ? promptLogs.path : '/tmp';
    if (promptLogs.enabled && promptLogs.path) {
      fs.mkdirSync(promptDir, { recursive: true });
    }
    const promptFile = path.join(promptDir, `pr-review-${Date.now()}.txt`);
    fs.writeFileSync(promptFile, prompt);

    try {
      logger.info('Executing Claude CLI...');
      const startTime = Date.now();

      const claudeConfig = getConfig().claude || {};
      const model = claudeConfig.model || 'sonnet';

      logger.info(`Running claude process with model selected: ${model}`);

      let timeoutMinutes = parseInt(claudeConfig.timeoutMinutes, 10);
      if (Number.isNaN(timeoutMinutes) || timeoutMinutes <= 0) {
        timeoutMinutes = 10;
      }

      logger.info(
        `Starting Claude analysis with ${model} model (timeout: ${timeoutMinutes} minutes)...`,
      );

      // Set environment variables for the child process
      const env = {
        ...process.env,
        SHELL: '/bin/bash',
        HOME: '/home/node',
        PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      };

      // Use stdin instead of command substitution to avoid shell issues
      const { spawn } = require('child_process');

      const claudeProcess = spawn(
        'claude',
        ['--dangerously-skip-permissions', '--model', model, '--output-format', 'text'],
        {
          cwd: projectResult.path,
          env: env,
          shell: false,
        },
      );

      // Create a promise to handle the process
      const result = await new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';

        // Set timeout
        const timeoutMs = timeoutMinutes * 60 * 1000;
        const timeout = setTimeout(() => {
          claudeProcess.kill('SIGTERM');
          reject(
            new Error(
              `Claude analysis timed out after ${timeoutMinutes} minutes. The PR might be too large or complex.`,
            ),
          );
        }, timeoutMs);

        claudeProcess.stdout.on('data', data => {
          const chunk = data.toString();
          stdout += chunk;
          // Log progress (optional, can be removed if too verbose)
          process.stdout.write(chunk);
        });

        claudeProcess.stderr.on('data', data => {
          const chunk = data.toString();
          stderr += chunk;
          process.stderr.write(chunk);
        });

        claudeProcess.on('close', code => {
          clearTimeout(timeout);
          if (code === 0) {
            resolve({ stdout, stderr });
          } else {
            // Log both stdout and stderr to help debug
            logger.error(`Claude CLI failed with code: ${code}`);
            if (stderr) logger.error(`STDERR: ${stderr}`);
            if (stdout) logger.error(`STDOUT: ${stdout}`);
            reject(
              new Error(
                `Claude CLI exited with code ${code}: ${stderr || stdout || 'No error output'}`,
              ),
            );
          }
        });

        claudeProcess.on('error', error => {
          clearTimeout(timeout);
          reject(error);
        });

        // Send the prompt via stdin
        const promptContent = fs.readFileSync(promptFile, 'utf8');
        claudeProcess.stdin.write(promptContent);
        claudeProcess.stdin.end();
      });

      const { stdout, stderr } = result;

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.info(`✓ Claude analysis completed in ${duration}s`);

      if (stderr) {
        logger.warn(`Claude CLI warnings: ${stderr}`);
      }

      if (!promptLogs.enabled && fs.existsSync(promptFile)) {
        fs.unlinkSync(promptFile);
      }

      // Extract metrics from JSON output
      let isLgtm = false;
      let issueCount = 0;
      let isReviewFailed = false;
      let failedReviewReason = null;

      // Look for JSON block in the response (should be at the end)
      const jsonMatch = stdout.match(/```json\s*\n\s*({[\s\S]*?})\s*\n\s*```/);

      if (jsonMatch && jsonMatch[1]) {
        try {
          const reviewMetrics = JSON.parse(jsonMatch[1]);
          isLgtm = reviewMetrics.isLgtm === true;
          issueCount = typeof reviewMetrics.issueCount === 'number' ? reviewMetrics.issueCount : 0;
          isReviewFailed = reviewMetrics.isReviewFailed === true;
          failedReviewReason = reviewMetrics.failedReviewReason || null;
          logger.info(
            `✓ Parsed metrics from JSON: isLgtm=${isLgtm}, issueCount=${issueCount}, isReviewFailed=${isReviewFailed}, failedReviewReason=${failedReviewReason}`,
          );
        } catch (parseError) {
          logger.error(`Error parsing metrics JSON: ${parseError.message}`);
          throw new Error(`Failed to parse metrics JSON: ${parseError.message}`);
        }
      } else {
        logger.error('❌ No JSON metrics found in Claude response');
        // Default to conservative metrics
        isLgtm = false;
        issueCount = 0;
        isReviewFailed = false;
        failedReviewReason = null;
      }

      // Track review failure if indicated by Claude
      if (isReviewFailed) {
        const errorType = failedReviewReason ? 'claude_reported' : 'unknown';
        metrics.claudeReviewFailureCounter.inc({ repository, error_type: errorType });
        logger.error(
          `Claude reported review failure: ${failedReviewReason || 'No reason provided'}`,
        );
        logger.debug(
          `Metrics: Incremented failed review counter for ${repository} (error: ${errorType})`,
        );
      } else {
        // Track successful review
        metrics.claudeReviewSuccessCounter.inc({ repository });
        metrics.claudeReviewDurationHistogram.observe(
          { repository, status: 'success' },
          parseFloat(duration),
        );
        logger.debug(`Metrics: Incremented successful review counter for ${repository}`);
      }

      // Track LGTM or Issues
      if (isLgtm) {
        metrics.claudeLgtmCounter.inc({ repository });
        logger.debug(`Metrics: Incremented LGTM counter for ${repository}`);
      }

      if (issueCount > 0) {
        metrics.claudeIssuesCounter.inc({ repository }, issueCount);
        logger.debug(
          `Metrics: Incremented issues found counter by ${issueCount} for ${repository}`,
        );
      }

      return {
        success: true,
        response: stdout,
        duration: duration,
      };
    } catch (error) {
      // Clean up prompt file on error (only if not persisting)
      if (!promptLogs.enabled && fs.existsSync(promptFile)) {
        fs.unlinkSync(promptFile);
      }

      // Checking if it's a timeout error
      if (
        error.killed ||
        error.signal === 'SIGTERM' ||
        /timed out after \d+ minutes/.test(error.message)
      ) {
        const claudeCfg = getConfig().claude || {};
        let timeoutMinutes = parseInt(claudeCfg.timeoutMinutes, 10);
        if (Number.isNaN(timeoutMinutes) || timeoutMinutes <= 0) {
          timeoutMinutes = 10;
        }
        logger.error(`❌ Claude CLI timed out after ${timeoutMinutes} minutes`);
        throw new Error(
          `Claude analysis timed out after ${timeoutMinutes} minutes. The PR might be too large or complex.`,
        );
      }

      throw error;
    }
  } catch (error) {
    logger.error(`Error executing Claude CLI: ${error.message}`);

    // Track failed review
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const errorType = error.message.includes('timeout')
      ? 'timeout'
      : error.message.includes('clone')
        ? 'git_error'
        : 'unknown';

    metrics.claudeReviewFailureCounter.inc({ repository, error_type: errorType });
    metrics.claudeReviewDurationHistogram.observe(
      { repository, status: 'failure' },
      parseFloat(duration),
    );
    logger.debug(
      `Metrics: Incremented failed review counter for ${repository} (error: ${errorType})`,
    );

    throw error;
  }
}

module.exports = {
  processPullRequest,
};
