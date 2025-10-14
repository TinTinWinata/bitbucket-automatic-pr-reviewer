const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const { ensureProjectExists } = require('./git');
const { metrics } = require('./metrics');
const TemplateManager = require('./templateManager');

const execAsync = promisify(exec);

/**
 * Process pull request with Claude
 * @param {Object} prData - Pull request data from Bitbucket webhook
 */
async function processPullRequest(prData) {
  const repository = prData.repository;
  const startTime = Date.now();
  
  try {
    console.log('Processing PR with Claude...');
    console.log(`PR Title: ${prData.title}`);
    console.log(`Author: ${prData.author}`);
    console.log(`Repository: ${prData.repository}`);

    // STEP 1: Validate and ensure project is cloned
    console.log('\n=== Step 1: Validating Project ===');
    const repoData = {
      name: prData.repository,
      cloneUrl: prData.repoCloneUrl,
      sourceBranch: prData.sourceBranch
    };

    const projectResult = await ensureProjectExists(repoData);
    console.log(`Project validation result:`, projectResult);
    
    if (!projectResult.success) {
      throw new Error('Failed to ensure project exists');
    }

    console.log(`Project path: ${projectResult.path}`);
    console.log(`Was cloned: ${projectResult.wasCloned ? 'Yes' : 'No (already existed)'}`);
    console.log('================================\n');

    // STEP 2: Process with Claude CLI
    console.log('=== Step 2: Processing with Claude CLI ===');

    const templateManager = new TemplateManager();
    const prompt = templateManager.getPromptForPR(prData);

    // Write prompt to temporary file
    const promptFile = path.join('/tmp', `pr-review-${Date.now()}.txt`);
    fs.writeFileSync(promptFile, prompt);

    try {
      console.log('Executing Claude CLI...');
      const startTime = Date.now();
      
      // Copy .mcp.json to project directory so Claude CLI can use MCP servers
      const mcpSourcePath = path.join('/app', '.mcp.json');
      const mcpDestPath = path.join(projectResult.path, '.mcp.json');
      
      if (fs.existsSync(mcpSourcePath)) {
        fs.copyFileSync(mcpSourcePath, mcpDestPath);
        console.log(`✓ Copied .mcp.json to ${mcpDestPath}`);
      } else {
        console.warn('⚠ Warning: .mcp.json not found at /app/.mcp.json - Bitbucket MCP will not be available');
      }
      
      // Get model from env or default to sonnet
      const model = process.env.CLAUDE_MODEL || 'sonnet';
      
      console.log(`Starting Claude analysis with ${model} model (timeout: 10 minutes)...`);
      
      
      // Set environment variables for the child process
      const env = {
        ...process.env,
        SHELL: '/bin/bash',
        HOME: '/home/node',
        PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
      };
      
      // Use stdin instead of command substitution to avoid shell issues
      const { spawn } = require('child_process');
      
      const claudeProcess = spawn('claude', [
        '--dangerously-skip-permissions',
        '--model', model,
        '--output-format', 'text'
      ], {
        cwd: projectResult.path,
        env: env,
        shell: false
      });
      
      // Create a promise to handle the process
      const result = await new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        
        // Set timeout
        const timeout = setTimeout(() => {
          claudeProcess.kill('SIGTERM');
          reject(new Error('Claude analysis timed out after 10 minutes. The PR might be too large or complex.'));
        }, 10 * 60 * 1000);
        
        claudeProcess.stdout.on('data', (data) => {
          const chunk = data.toString();
          stdout += chunk;
          // Log progress (optional, can be removed if too verbose)
          process.stdout.write(chunk);
        });
        
        claudeProcess.stderr.on('data', (data) => {
          const chunk = data.toString();
          stderr += chunk;
          process.stderr.write(chunk);
        });
        
        claudeProcess.on('close', (code) => {
          clearTimeout(timeout);
          if (code === 0) {
            resolve({ stdout, stderr });
          } else {
            // Log both stdout and stderr to help debug
            console.error('Claude CLI failed with code:', code);
            if (stderr) console.error('STDERR:', stderr);
            if (stdout) console.error('STDOUT:', stdout);
            reject(new Error(`Claude CLI exited with code ${code}: ${stderr || stdout || 'No error output'}`));
          }
        });
        
        claudeProcess.on('error', (error) => {
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
      console.log(`✓ Claude analysis completed in ${duration}s`);

      if (stderr) {
        console.warn('Claude CLI warnings:', stderr);
      }

      fs.unlinkSync(promptFile);

      // Extract metrics from JSON output
      let isLgtm = false;
      let issueCount = 0;
      
      // Look for JSON block in the response (should be at the end)
      const jsonMatch = stdout.match(/```json\s*\n\s*({[\s\S]*?})\s*\n\s*```/);
      
      if (jsonMatch && jsonMatch[1]) {
        try {
          const reviewMetrics = JSON.parse(jsonMatch[1]);
          isLgtm = reviewMetrics.isLgtm === true;
          issueCount = typeof reviewMetrics.issueCount === 'number' ? reviewMetrics.issueCount : 0;
          console.log(`✓ Parsed metrics from JSON: isLgtm=${isLgtm}, issueCount=${issueCount}`);
        } catch (parseError) {
          console.error('Error parsing metrics JSON:', parseError.message);
          throw new Error(`Failed to parse metrics JSON: ${parseError.message}`);
        }
      } else {
        console.error('❌ No JSON metrics found in Claude response');
        // Default to conservative metrics
        isLgtm = false;
        issueCount = 0;
      }
      
      // Track successful review
      metrics.claudeReviewSuccessCounter.inc({ repository });
      metrics.claudeReviewDurationHistogram.observe({ repository, status: 'success' }, parseFloat(duration));
      console.log(`Metrics: Incremented successful review counter for ${repository}`);
      
      // Track LGTM or Issues
      if (isLgtm) {
        metrics.claudeLgtmCounter.inc({ repository });
        console.log(`Metrics: Incremented LGTM counter for ${repository}`);
      }
      
      if (issueCount > 0) {
        metrics.claudeIssuesCounter.inc({ repository }, issueCount);
        console.log(`Metrics: Incremented issues found counter by ${issueCount} for ${repository}`);
      }

      return {
        success: true,
        response: stdout,
        duration: duration
      };

    } catch (error) {
      // Clean up prompt file on error
      if (fs.existsSync(promptFile)) {
        fs.unlinkSync(promptFile);
      }
      
      // Check if it's a timeout error
      if (error.killed || error.signal === 'SIGTERM') {
        console.error('❌ Claude CLI timed out after 10 minutes');
        throw new Error('Claude analysis timed out after 10 minutes. The PR might be too large or complex.');
      }
      
      throw error;
    }

  } catch (error) {
    console.error('Error executing Claude CLI:', error);
    
    // Track failed review
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const errorType = error.message.includes('timeout') ? 'timeout' : 
                      error.message.includes('clone') ? 'git_error' : 
                      'unknown';
    
    metrics.claudeReviewFailureCounter.inc({ repository, error_type: errorType });
    metrics.claudeReviewDurationHistogram.observe({ repository, status: 'failure' }, parseFloat(duration));
    console.log(`Metrics: Incremented failed review counter for ${repository} (error: ${errorType})`);
    
    throw error;
  }
}

module.exports = {
  processPullRequest
};

