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
      logger.warn(
        'Failed to load template config, using defaults: ',
        error.message
      );
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
    const customPath = path.join(
      this.templatesDir,
      'custom',
      `${templateName}.md`
    );

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
      .filter((section) => !template.includes(section))
      .map((section) => `Missing required section: ${section}`);

    errors = errors.concat(missingSectionsErrors);

    // Check for malformed variable syntax
    const malformedVars = template.match(/{{[^}]*$|^[^{]*}}/g);
    if (malformedVars) {
      errors.push(
        `Malformed variable syntax found: ${malformedVars.join(', ')}`
      );
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
    const foundVars = uniqueVars.map((v) => v.replace(/{{|}}/g, ''));
    const missingRecommended = recommendedVars.filter(
      (v) => !foundVars.includes(v)
    );

    if (missingRecommended.length > 0) {
      logger.warn(
        `Note: Template is missing recommended variables: ${missingRecommended.join(
          ', '
        )}`
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
   * @return {string} Processed prompt ready for Claude
   */
  getPromptForPR(prData) {
    const templateName = this.getTemplateForRepository(prData.repository);
    const template = this.loadTemplate(templateName);

    // Validate template before processing
    const validation = this.validateTemplate(template);
    if (!validation.success) {
      logger.error('Template validation failed:', validation.errors);
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

    return this.substituteVariables(template, variables);
  }
}

module.exports = TemplateManager;