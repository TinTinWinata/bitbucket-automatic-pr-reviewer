function normalizeList(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map(value =>
      String(value || '')
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Check if comment starts with /review prefix command (optionally followed by text).
 * Matches: "/review", "/review ", "/review anything here"
 */
function textHasPrefixCommand(text, commandPrefix) {
  const prefix = (commandPrefix || '/review').trim().toLowerCase();
  if (!prefix) return false;
  const escaped = escapeRegExp(prefix);
  const regex = new RegExp(`^\\s*${escaped}(\\s|$)`, 'i');
  return regex.test(text.trim());
}

/**
 * Extract mention IDs from Bitbucket raw format: @{id} or @{workspace:id}
 * Returns array of extracted IDs (lowercase for comparison).
 */
function extractMentionIds(text) {
  const ids = [];
  const regex = /@\{([^}]+)\}/g;
  let m;
  while ((m = regex.exec(text)) !== null) {
    ids.push(String(m[1]).trim().toLowerCase());
  }
  return ids;
}

/**
 * Check if text contains a mention of one of the configured bot IDs.
 */
function textHasBotMention(text, botIds) {
  const ids = normalizeList(botIds);
  if (ids.length === 0) return false;
  const mentioned = extractMentionIds(text);
  return mentioned.some(id => ids.includes(id));
}

function textHasKeyword(text, keywords) {
  const normalizedKeywords = normalizeList(keywords);
  if (normalizedKeywords.length === 0) return false;

  return normalizedKeywords.some(keyword => {
    const keywordRegex = new RegExp(`(^|\\s)${escapeRegExp(keyword)}(?=\\b|\\s|$)`, 'i');
    return keywordRegex.test(text);
  });
}

/**
 * Parse manual review trigger. Returns true if EITHER:
 * 1. Comment starts with /review prefix command
 * 2. Comment mentions configured bot ID(s) AND contains keyword (e.g. "review")
 */
function parseManualReviewTrigger(commentText, config) {
  const text = String(commentText || '').trim();
  if (!text) {
    return { shouldTrigger: false, reason: 'empty-comment' };
  }

  const prefixCommand = config?.prefixCommand ?? '/review';
  const keywords = config?.keywords || ['review'];
  const botIds = config?.botIds || [];

  // Rule 1: /review prefix command
  if (textHasPrefixCommand(text, prefixCommand)) {
    return { shouldTrigger: true, reason: 'matched-prefix-command' };
  }

  // Rule 2: bot mention (by ID) + keyword
  const hasBotMention = textHasBotMention(text, botIds);
  const hasKeyword = textHasKeyword(text, keywords);

  if (hasBotMention && hasKeyword) {
    return { shouldTrigger: true, reason: 'matched-mention-keyword' };
  }

  if (!hasBotMention && !hasKeyword) {
    return { shouldTrigger: false, reason: 'missing-prefix-and-mention-keyword' };
  }
  if (!hasBotMention) {
    return { shouldTrigger: false, reason: 'missing-mention' };
  }
  return { shouldTrigger: false, reason: 'missing-keyword' };
}

function getCommentText(payload) {
  return payload?.comment?.content?.raw || '';
}

function getCommentAuthor(payload) {
  return (
    payload?.comment?.user?.display_name ||
    payload?.actor?.display_name ||
    payload?.pullrequest?.author?.display_name ||
    ''
  );
}

function getCommentId(payload) {
  const id = payload?.comment?.id;
  return id === undefined || id === null ? '' : String(id);
}

module.exports = {
  parseManualReviewTrigger,
  getCommentText,
  getCommentAuthor,
  getCommentId,
  extractMentionIds,
  textHasPrefixCommand,
  textHasBotMention,
};
