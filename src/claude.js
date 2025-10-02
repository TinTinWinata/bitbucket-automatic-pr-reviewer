const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const { ensureProjectExists } = require('./git');
const { metrics } = require('./metrics');

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

    const prompt = `**Role:**  
You are an autonomous code reviewer with terminal access and the Bitbucket MCP connected.
**Goal:**  
Fetch PR details + file diffs from the given Bitbucket URL, safely switch to the PR branch, review changes, and post a **single PR summary comment**.

**PR:**  
\`${prData.prUrl}\`

---

## Operating Rules
- Use Bitbucket MCP tools for PR data and posting a **single summary comment** only.
- Use the terminal for safe git operations: stash, checkout branch, restore previous state.
- Be idempotent: always restore original branch and pop stash if needed.
- **IMPORTANT**: Use MCP tools directly, not as shell commands. Do not run commands like "mcp__bitbucket__list_tools" in bash.

---

## Step-by-Step Plan

### 1. Review Changes
- Read through all changed files.
- Identify logic errors, security concerns, performance bottlenecks, missing edge case handling, and lack of tests.

### 2. Post Single PR Summary Comment
- Use Bitbucket MCP tools to post the summary comment to the PR.

Use this template for the summary if the PR needs to be changed:

\`\`\`
# PR Review Summary

---

## Status: 🚨 Possibility Issue

*<1–2 sentences about what the PR changes>*

## Issues:

1. **<Issue Title>** - <brief description>

*<detailed explanation>*

**Existing Code**:

<current issue snippet>

**Fix Implementation**:

<example fixed implementation>

---

2. **<Issue Title>** - <brief description>

*<detailed explanation>*

---

3. **<Issue Title>** - <brief description>

*<detailed explanation>*

\`\`\`

Use this template for the summary if the PR is good and no issues were found:

\`\`\`
# PR Review Summary

## Status: ✅ LGTM — No issues found.

*<1–2 sentences about what the PR changes>*

The implementation follows best practices, and the changes are ready to be merged.

\`\`\`

No need to show any others things other then the given template (e.g. \`Key improvements\` or \`Technical details\`)`;

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
      
      console.log(`Starting Claude analysis with ${model} model (timeout: 5 minutes)...`);
      
      
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
          reject(new Error('Claude analysis timed out after 5 minutes. The PR might be too large or complex.'));
        }, 5 * 60 * 1000);
        
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

      // Analyze the response to track metrics
      const isLgtm = stdout.includes('✅ LGTM') || stdout.includes('LGTM');
      
      // Count the actual number of issues found by parsing the response
      // Look for numbered issues in various formats: "1)", "1.", "### 1)", etc.
      let issueCount = 0;
      
      // Check if this is a review with issues (multiple detection methods)
      const hasIssuesMarker = stdout.includes('🚨 Possibility Issue') || 
                             stdout.includes('Issues:') || 
                             /\d+\s+(?:critical\s+)?issues?/i.test(stdout) || // "6 critical issues" or "3 issues"
                             /identifying\s+\d+\s+issues?/i.test(stdout); // "identifying 6 issues"
      
      if (hasIssuesMarker && !isLgtm) {
        // Try to extract issue count from text like "6 critical issues" or "identifying 5 issues"
        const issueCountMatch = stdout.match(/(?:found|identifying)\s+(\d+)\s+(?:critical\s+)?issues?/i);
        
        if (issueCountMatch) {
          // Found explicit issue count in text
          issueCount = parseInt(issueCountMatch[1], 10);
          console.log(`Found ${issueCount} issues from text: "${issueCountMatch[0]}"`);
        } else {
          // Count numbered list items as fallback
          // Match patterns like:
          // - "1. **Title**" (markdown numbered list)
          // - "1) Title" (parentheses format)
          // - "### 1) Title" or "### 1. Title" (with headers)
          const issueMatches = stdout.match(/(?:^|\n)\s*\d+[.)]\s+\*\*[^*]+\*\*/gm);
          if (issueMatches) {
            issueCount = issueMatches.length;
            console.log(`Found ${issueCount} issues by counting numbered list items`);
          } else {
            // Last fallback: if issues detected but can't parse count
            console.log('Issues detected but could not parse count, defaulting to 1');
            issueCount = 1;
          }
        }
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
        console.error('❌ Claude CLI timed out after 5 minutes');
        throw new Error('Claude analysis timed out after 5 minutes. The PR might be too large or complex.');
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

