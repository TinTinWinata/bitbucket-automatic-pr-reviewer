const fs = require('fs');
const path = require('path');
const logger = require('./logger').default;
const { getConfig } = require('./config/loader');

const MAX_JOBS = 200;
const storageDir = getConfig().metrics?.persistence?.path || '/app/metrics-storage';
const historyFile = path.join(storageDir, 'jobs.json');

const jobs = load();

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    return saved.map(job =>
      job.status === 'running'
        ? {
            ...job,
            status: 'failed',
            finishedAt: job.startedAt,
            error: 'Interrupted by a service restart',
          }
        : job,
    );
  } catch {
    return [];
  }
}

function save() {
  try {
    fs.writeFileSync(historyFile, JSON.stringify(jobs));
  } catch (error) {
    logger.warn(`Failed to save job history: ${error.message}`);
  }
}

function startJob({ prData, type }) {
  const job = {
    type,
    repository: prData.repository,
    title: prData.title,
    prUrl: prData.prUrl,
    author: prData.author,
    triggeredBy: prData.triggeredBy || null,
    startedAt: Date.now(),
    status: 'running',
  };
  jobs.unshift(job);
  jobs.length = Math.min(jobs.length, MAX_JOBS);
  save();
  return job;
}

function finishJob(job, result = {}) {
  job.finishedAt = Date.now();
  job.isLgtm = result.isLgtm ?? null;
  job.issueCount = result.issueCount ?? null;
  if (result.isReviewFailed) {
    job.status = 'failed';
    job.error = result.failedReviewReason || 'Claude reported the review as failed';
  } else {
    job.status = 'success';
  }
  save();
}

function failJob(job, error) {
  job.finishedAt = Date.now();
  job.status = 'failed';
  job.error = String(error.message || error).slice(0, 500);
  save();
}

module.exports = { jobs, startJob, finishJob, failJob };
