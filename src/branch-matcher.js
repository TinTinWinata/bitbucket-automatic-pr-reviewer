const logger = require('./logger').default;
const { getConfig } = require('./config/loader');

/**
 * Compile regex patterns and return an array of RegExp, or null if invalid/disabled.
 * @param {string[]} patterns - Array of regex pattern strings
 * @param {string} ruleName - Rule name for logging
 * @returns {RegExp[]|null} - Array of RegExp, or null if any invalid or empty and treat as "no match"
 */
function compilePatterns(patterns, ruleName) {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    return null;
  }
  const compiled = [];
  for (let i = 0; i < patterns.length; i++) {
    try {
      compiled.push(new RegExp(patterns[i]));
    } catch (err) {
      logger.warn(
        `Branch matcher: invalid regex in ${ruleName}.patterns[${i}] "${patterns[i]}": ${err.message}. Rule disabled for this pattern.`,
      );
      return null;
    }
  }
  return compiled;
}

/**
 * Load and compile branch rules from config.
 * @returns {{ prReview: { target: RegExp[]|null, source: RegExp[]|null, enabled: boolean }, releaseNote: { target: RegExp[]|null, source: RegExp[]|null, enabled: boolean } }}
 */
function loadRules() {
  const config = getConfig();
  const prReview = config.prReview || {};
  const releaseNote = config.releaseNote || {};

  const prReviewTarget = compilePatterns(
    prReview.targetBranchPatterns,
    'prReview.targetBranchPatterns',
  );
  const prReviewSource = compilePatterns(
    prReview.sourceBranchPatterns,
    'prReview.sourceBranchPatterns',
  );
  const releaseNoteTarget = compilePatterns(
    releaseNote.targetBranchPatterns,
    'releaseNote.targetBranchPatterns',
  );
  const releaseNoteSource = compilePatterns(
    releaseNote.sourceBranchPatterns,
    'releaseNote.sourceBranchPatterns',
  );

  return {
    prReview: {
      enabled: prReview.enabled !== false,
      target: prReviewTarget,
      source: prReviewSource,
    },
    releaseNote: {
      enabled: releaseNote.enabled === true,
      target: releaseNoteTarget,
      source: releaseNoteSource,
    },
  };
}

let cachedRules = null;

function getRules() {
  if (!cachedRules) {
    cachedRules = loadRules();
  }
  return cachedRules;
}

/**
 * Check if at least one pattern matches the branch name.
 * @param {RegExp[]|null} patterns - Compiled regex array or null
 * @param {string} branchName - Branch name to test
 * @returns {boolean}
 */
function matchesAny(patterns, branchName) {
  if (!patterns || patterns.length === 0) return false;
  return patterns.some(re => re.test(branchName));
}

/**
 * Evaluate one rule against prData. Target must match; if rule has source patterns, source must match too.
 * @param {{ target: RegExp[]|null, source: RegExp[]|null, enabled: boolean }} rule
 * @param {{ sourceBranch: string, destinationBranch: string }} prData
 * @param {boolean} emptyTargetMeansMatchAll - If true, empty target patterns = match all (for prReview)
 * @returns {boolean}
 */
function ruleMatches(rule, prData, emptyTargetMeansMatchAll) {
  if (!rule.enabled) return false;
  const target = prData.destinationBranch || '';
  const source = prData.sourceBranch || '';

  const targetMatch =
    emptyTargetMeansMatchAll && !rule.target ? true : matchesAny(rule.target, target);
  if (!targetMatch) return false;

  if (rule.source && rule.source.length > 0) {
    if (!matchesAny(rule.source, source)) return false;
  }
  return true;
}

/**
 * Whether to enqueue a PR review job for this PR.
 * Backward compat: if prReview is missing or has no target patterns, treat as match all.
 * @param {Object} prData - Pull request data with sourceBranch, destinationBranch
 * @returns {boolean}
 */
function shouldRunReview(prData) {
  const rules = getRules();
  return ruleMatches(rules.prReview, prData, true);
}

/**
 * Whether to enqueue a create-release-note job for this PR.
 * Only when releaseNote is enabled and branch patterns match.
 * @param {Object} prData - Pull request data with sourceBranch, destinationBranch
 * @returns {boolean}
 */
function shouldCreateReleaseNote(prData) {
  const rules = getRules();
  return ruleMatches(rules.releaseNote, prData, false);
}

/**
 * Reset cached rules (for tests or config reload).
 */
function clearCache() {
  cachedRules = null;
}

module.exports = {
  shouldRunReview,
  shouldCreateReleaseNote,
  getRules,
  clearCache,
};
