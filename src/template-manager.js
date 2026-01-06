const fs = require('fs');
const path = require('path');
const logger = require('./logger').default;

/**
 * Template Manager - Handles loading and processing PR review templates
 */

class TemplateManager {
  constructor() {
    this.templatesDir = path.join(__dirname, 'templates');
    this.configPath = path.join(__dirname, 'config', 'template-config.json');
    this.config = this.loadConfig();
  }
  /**
   * Load template configuration
   */
  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const configData = fs.readFileSync(this.configPath, 'utf8');
        return JSON.parse(configData);
      }
      return { defaultTemplate: 'default', repositories: {} };
    } catch (error) {
      logger.warn('Failed to load template config, using defaults: ', error.message);
      return { defaultTemplate: 'default', repositories: {} };
    }
  }

  /**
   * Get template for a specific repository
   * @param {string} repository - Repository name
   * @return {string} Template name to use
   */
  getTemplateForRepository(repository) {
    return this.config.repositories[repository] || this.config.defaultTemplate;
  }

  /**
   * Load template file
   * @param {string} templateName - Name of the template (e.g., 'default', 'custom')
   * @return {string} Template content
   */
  loadTemplate(templateName) {
    // Try custom template first
    const customPath = path.join(this.templatesDir, 'custom', `${templateName}.md`);

    if (fs.existsSync(customPath)) {
      logger.info(`Loading custom template: ${templateName}`);
      return fs.readFileSync(customPath, 'utf-8');
    }

    // Fall back to default template
    const defaultPath = path.join(this.templatesDir, 'default', 'prompt.md');
    if (fs.existsSync(defaultPath)) {
      logger.info(`Loading default template for: ${templateName}`);
      return fs.readFileSync(defaultPath, 'utf-8');
    }
    throw new Error(`Template not found: ${templateName}`);
  }

  /**
   * Substitute variables in template
   * @param {string} template - Template content with variables
   * @param {Object} variables - Key-value pairs to substitute
   * @return {string} Processed template
   */
  substituteVariables(template, variables) {
    return template.replace(/{{(\w+)}}/g, (_, key) => {
      if (variables[key] === undefined) {
        logger.warn(`Warning: Variable {{${key}}} not found in template variables`);
        return `{{${key}}}`;
      }
      return variables[key];
    });
  }

  /**
   * Validate template format
   * @param {string} template - The template string to validate
   * @return {Object} validation result with success flag and errors
   */

  validateTemplate(template) {
    let errors = [];
    const requiredSections = ['Role:', 'Goal:', 'PR:'];

    // Check if template is empty
    if (!template || template.trim().length === 0) {
      errors.push('Template is empty');
      return { success: false, errors };
    }

    // Check for required sections
    const missingSectionsErrors = requiredSections
      .filter(section => !template.includes(section))
      .map(section => `Missing required section: ${section}`);

    errors = errors.concat(missingSectionsErrors);

    // Check for malformed variable syntax
    const malformedVars = template.match(/{{[^}]*$|^[^{]*}}/g);
    if (malformedVars) {
      errors.push(`Malformed variable syntax found: ${malformedVars.join(', ')}`);
    }

    const variables = template.match(/{{(\w+)}}/g) || [];
    const uniqueVars = [...new Set(variables)];

    // Warn about recommended variables
    const recommendedVars = [
      'prUrl',
      'title',
      'description',
      'author',
      'sourceBranch',
      'destinationBranch',
      'repository',
    ];
    const foundVars = uniqueVars.map(v => v.replace(/{{|}}/g, ''));
    const missingRecommended = recommendedVars.filter(v => !foundVars.includes(v));

    if (missingRecommended.length > 0) {
      logger.warn(
        `Note: Template is missing recommended variables: ${missingRecommended.join(', ')}`,
      );
    }

    return {
      success: errors.length === 0,
      errors,
      variables: uniqueVars,
      warnings:
        missingRecommended.length > 0
          ? [`Missing recommended variables: ${missingRecommended.join(', ')}`]
          : [],
    };
  }

  /**
   * Get prompt for PR review
   * @param {Object} prData - Pull request data
   * @param {Object} options - Additional options
   * @param {string|null} options.diff - Diff content to include (if small enough)
   * @param {boolean} options.diffTooLarge - Whether diff is too large to include
   * @param {string} options.sourceBranch - Source branch name
   * @param {string} options.destinationBranch - Destination branch name
   * @return {string} Processed prompt ready for Claude
   */
  getPromptForPR(prData, options = {}) {
    const templateName = this.getTemplateForRepository(prData.repository);
    const template = this.loadTemplate(templateName);

    // Validate template before processing
    const validation = this.validateTemplate(template);
    if (!validation.success) {
      logger.error(`Template validation failed: ${JSON.stringify(validation.errors)}`);
      throw new Error(`Invalid template: ${validation.errors.join(', ')}`);
    }

    // Log successful validation
    logger.info('Template validation passed');
    if (validation.variables.length > 0) {
      logger.debug(`Variables found: ${validation.variables.join(', ')}`);
    }

    const variables = {
      prUrl: prData.prUrl || '',
      title: prData.title || '',
      description: prData.description || '',
      author: prData.author || '',
      sourceBranch: prData.sourceBranch || '',
      destinationBranch: prData.destinationBranch || '',
      repository: prData.repository || '',
      repoCloneUrl: prData.repoCloneUrl || '',
    };

    let prompt = this.substituteVariables(template, variables);

    // Add diff or instructions based on size
    if (options.diff && !options.diffTooLarge) {
      // Include diff directly in prompt
      prompt += '\n\n---\n\n## PR Changes (from merge-base)\n\n';
      prompt +=
        'The following diff shows ONLY the changes made by the PR author, calculated from the merge-base:\n\n';
      prompt += '```diff\n';
      prompt += options.diff;
      prompt += '\n```\n';
      logger.info('Included diff directly in prompt');
    } else if (options.diffTooLarge) {
      // Add instructions for large diffs
      const mergeBaseInstructions = `

---

## ⚠️ IMPORTANT: Reviewing Large PR Changes

This PR contains a large number of changes. When fetching the diff using Bitbucket MCP tools, you **MUST** ensure you only review changes made by the PR author, not changes from other commits that may have been merged into the destination branch after this PR was created.

### Critical Instructions:

1. **Use Merge-Base Comparison**: When getting the diff, use the merge-base approach to isolate only the PR author's changes:
   - Find the common ancestor (merge-base) between \`${options.sourceBranch}\` and \`${options.destinationBranch}\`
   - Compare only from merge-base to the source branch: \`merge-base..${options.sourceBranch}\`
   - Do NOT compare branch tips directly: \`${options.destinationBranch}..${options.sourceBranch}\` (this would include unrelated changes)

2. **Use PR Diff Endpoint**: If available, use the Bitbucket PR's diff endpoint which should already compute the correct diff based on merge-base, rather than doing a branch-to-branch comparison.

3. **What to Review**: Only review changes that are part of this PR. Ignore any changes that were merged into the destination branch after this PR was created.

### Example Git Command (if using terminal):
\`\`\`bash
# Find merge-base
MERGE_BASE=$(git merge-base origin/${options.destinationBranch} origin/${options.sourceBranch})

# Get only PR author's changes
git diff $MERGE_BASE..origin/${options.sourceBranch}
\`\`\`

**Remember**: The goal is to review ONLY the changes introduced by this PR, not changes from other contributors that may have been merged into the destination branch.
`;
      prompt += mergeBaseInstructions;
      logger.info('Added merge-base instructions for large diff');
    }

    return prompt;
  }
}

module.exports = TemplateManager;
