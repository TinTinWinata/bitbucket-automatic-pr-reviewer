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

function textHasMention(text, botNames) {
  const normalizedNames = normalizeList(botNames);
  if (normalizedNames.length === 0) {
    return false;
  }

  return normalizedNames.some(name => {
    const mentionRegex = new RegExp(`(^|\\s)@${escapeRegExp(name)}(?=\\b|\\s|$)`, 'i');
    return mentionRegex.test(text);
  });
}

function textHasKeyword(text, keywords) {
  const normalizedKeywords = normalizeList(keywords);
  if (normalizedKeywords.length === 0) return false;

  return normalizedKeywords.some(keyword => {
    const keywordRegex = new RegExp(`(^|\\s)${escapeRegExp(keyword)}(?=\\b|\\s|$)`, 'i');
    return keywordRegex.test(text);
  });
}

function parseManualReviewTrigger(commentText, config) {
  const text = String(commentText || '').trim();
  if (!text) {
    return { shouldTrigger: false, reason: 'empty-comment' };
  }

  const requireMention = config?.requireMention !== false;
  const keywords = config?.keywords || ['review'];
  const botNames = config?.botNames || [];

  if (!textHasKeyword(text, keywords)) {
    return { shouldTrigger: false, reason: 'missing-keyword' };
  }

  if (requireMention && !textHasMention(text, botNames)) {
    return { shouldTrigger: false, reason: 'missing-mention' };
  }

  return { shouldTrigger: true, reason: 'matched' };
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
  normalizeList,
};
