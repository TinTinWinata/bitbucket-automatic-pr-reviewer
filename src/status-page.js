const fs = require('fs');
const { execFile } = require('child_process');
const { register } = require('./metrics');
const jobHistory = require('./job-history');
const { isClaudeUnusable } = require('./teams-alert');

const CLI_CHECK_TTL_MS = 60 * 1000;
const CREDENTIALS_FILE = '/home/node/.claude/.credentials.json';
const COUNTER_FIELDS = {
  pr_created_total: 'prsCreated',
  claude_review_success_total: 'reviews',
  claude_review_failure_total: 'failures',
  claude_lgtm_total: 'lgtm',
  claude_issues_found_total: 'issues',
};

const processStartedAt = Date.now();
let cliCheck = { checkedAt: 0, version: null, error: null };

function checkCli() {
  if (Date.now() - cliCheck.checkedAt < CLI_CHECK_TTL_MS) return Promise.resolve(cliCheck);
  return new Promise(resolve => {
    execFile('claude', ['--version'], { timeout: 15000 }, (error, stdout) => {
      cliCheck = {
        checkedAt: Date.now(),
        version: error ? null : stdout.trim(),
        error: error ? error.message : null,
      };
      resolve(cliCheck);
    });
  });
}

function readAuth() {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return {
      mode: 'setup-token',
      detail: 'Long-lived token from claude setup-token (valid 1 year)',
    };
  }
  try {
    const oauth = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8')).claudeAiOauth || {};
    return {
      mode: 'login',
      detail: `/login session (${oauth.subscriptionType || 'unknown plan'}), refreshes itself until the login expires`,
      accessTokenExpiresAt: oauth.expiresAt || null,
    };
  } catch {
    return { mode: 'none', detail: 'No credentials found' };
  }
}

async function readTotals() {
  const byRepo = {};
  const row = repository =>
    (byRepo[repository] ||= {
      repository,
      prsCreated: 0,
      reviews: 0,
      failures: 0,
      lgtm: 0,
      issues: 0,
      durationSum: 0,
      durationCount: 0,
    });

  for (const metric of await register.getMetricsAsJSON()) {
    const field = COUNTER_FIELDS[metric.name];
    const isDuration = metric.name === 'claude_review_duration_seconds';
    if (!field && !isDuration) continue;
    for (const sample of metric.values || []) {
      const repository = sample.labels?.repository;
      if (!repository || repository === '_uninitialized') continue;
      if (field) {
        row(repository)[field] += sample.value;
      } else if (sample.labels.status === 'success') {
        if (sample.metricName.endsWith('_sum')) row(repository).durationSum += sample.value;
        if (sample.metricName.endsWith('_count')) row(repository).durationCount += sample.value;
      }
    }
  }
  return Object.values(byRepo).sort((a, b) => b.reviews - a.reviews);
}

async function buildStatus({ reviewQueue, circuitBreaker }) {
  const jobs = jobHistory.jobs;
  const cli = await checkCli();
  const lastFinished = jobs.find(job => job.status !== 'running');
  const lastFailure = jobs.find(job => job.status === 'failed') || null;
  const lastSuccess = jobs.find(job => job.status === 'success') || null;

  let health = 'healthy';
  if (
    !cli.version ||
    circuitBreaker.state === 'OPEN' ||
    (lastFinished?.status === 'failed' && isClaudeUnusable(lastFinished.error))
  ) {
    health = 'down';
  } else if (lastFinished?.status === 'failed') {
    health = 'degraded';
  }

  return {
    now: Date.now(),
    health,
    processStartedAt,
    cli: { version: cli.version, error: cli.error },
    auth: readAuth(),
    circuitBreaker: {
      state: circuitBreaker.state,
      failureCount: circuitBreaker.failureCount,
      threshold: circuitBreaker.failureThreshold,
    },
    running: jobs.find(job => job.status === 'running') || null,
    waiting: reviewQueue.map(({ prData, type }) => ({
      type,
      title: prData.title,
      prUrl: prData.prUrl,
      repository: prData.repository,
    })),
    lastSuccess,
    lastFailure,
    totals: await readTotals(),
    jobs: jobs.slice(0, 50),
  };
}

function internalOnly(req, res, next) {
  if (req.headers['cf-connecting-ip'] || req.headers['cf-ray']) {
    return res.status(404).end();
  }
  next();
}

function registerStatusRoutes(app, state) {
  app.get('/', internalOnly, (req, res) => {
    res.type('html').send(STATUS_HTML);
  });
  app.get('/api/status', internalOnly, async (req, res) => {
    res.json(await buildStatus(state));
  });
}

const STATUS_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PR Reviewer status</title>
<link rel="icon" href="data:,">
<style>
  :root {
    --page: #f9f9f7; --surface: #fcfcfb; --ink: #0b0b0b; --ink-2: #52514e; --muted: #898781;
    --line: #e4e3df; --good: #0ca30c; --warning: #fab219; --critical: #d03b3b;
  }
  @media (prefers-color-scheme: dark) {
    :root { --page: #0d0d0d; --surface: #1a1a19; --ink: #ffffff; --ink-2: #c3c2b7; --line: #2c2c2a; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--page); color: var(--ink); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 1200px; margin: 0 auto; padding: 24px; }
  header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  h1 { font-size: 20px; margin: 0; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-2); margin: 28px 0 10px; }
  .muted { color: var(--muted); }
  .pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); font-weight: 600; }
  .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .healthy .dot, .success .dot { background: var(--good); }
  .degraded .dot, .running .dot { background: var(--warning); }
  .down .dot, .failed .dot { background: var(--critical); }
  .banner { margin-top: 16px; padding: 12px 16px; border-radius: 8px; border: 1px solid var(--critical); border-left-width: 4px; background: var(--surface); }
  .banner pre { white-space: pre-wrap; margin: 6px 0 0; font-size: 12px; color: var(--ink-2); }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
  .tile { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; }
  .tile .label { color: var(--ink-2); font-size: 12px; }
  .tile .value { font-size: 28px; font-weight: 600; font-variant-numeric: tabular-nums; margin-top: 4px; }
  .tile .sub { color: var(--muted); font-size: 12px; }
  .grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 12px; }
  .panel { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 6px 16px; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 10px 0; }
  dt { color: var(--ink-2); }
  dd { margin: 0; overflow-wrap: anywhere; }
  table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--ink-2); font-weight: 600; font-size: 12px; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr:last-child td { border-bottom: 0; }
  .nowrap { white-space: nowrap; }
  a { color: inherit; }
  .err { color: var(--ink-2); font-size: 12px; max-width: 360px; overflow-wrap: anywhere; }
  footer { margin: 28px 0 8px; color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<main>
  <header>
    <h1>PR Reviewer</h1>
    <span id="health" class="pill"><span class="dot"></span><span>Loading</span></span>
    <span id="updated" class="muted"></span>
  </header>
  <div id="banner"></div>

  <h2>Totals</h2>
  <div class="tiles" id="tiles"></div>

  <div class="grid2">
    <div>
      <h2>Service</h2>
      <div class="panel"><dl id="service"></dl></div>
    </div>
    <div>
      <h2>Queue</h2>
      <div class="panel"><dl id="queue"></dl></div>
    </div>
  </div>

  <h2>By repository</h2>
  <table>
    <thead><tr><th>Repository</th><th class="num">PRs created</th><th class="num">Reviews</th><th class="num">Failed</th><th class="num">Success rate</th><th class="num">LGTM</th><th class="num">Issues found</th><th class="num">Avg review time</th></tr></thead>
    <tbody id="repos"></tbody>
  </table>

  <h2>Recent jobs</h2>
  <table>
    <thead><tr><th>Started</th><th>Result</th><th>PR</th><th>Repository</th><th>Type</th><th>Trigger</th><th class="num">Duration</th><th>Findings</th></tr></thead>
    <tbody id="jobs"></tbody>
  </table>

  <footer>Refreshes every 10 s · <a href="/api/status">/api/status</a> · <a href="/metrics">/metrics</a> (Prometheus)</footer>
</main>
<script>
const HEALTH_LABEL = { healthy: 'Healthy', degraded: 'Degraded', down: 'Down' };
const RESULT_LABEL = { success: 'Done', failed: 'Failed', running: 'Running' };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function ago(ms, now) {
  if (!ms) return '—';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}
function when(ms, now) {
  return ms ? '<span title="' + esc(new Date(ms).toLocaleString()) + '">' + ago(ms, now) + '</span>' : '—';
}
function secs(s) {
  if (s == null) return '—';
  return s < 60 ? Math.round(s) + 's' : Math.floor(s / 60) + 'm ' + Math.round(s % 60) + 's';
}
function pct(part, whole) {
  return whole ? Math.round((part / whole) * 100) + '%' : '—';
}
function prLink(job) {
  return '<a href="' + esc(job.prUrl) + '" target="_blank" rel="noopener">' + esc(job.title) + '</a>';
}
function status(kind, label) {
  return '<span class="pill ' + kind + '"><span class="dot"></span>' + esc(label) + '</span>';
}
function tile(label, value, sub) {
  return '<div class="tile"><div class="label">' + esc(label) + '</div><div class="value">' + esc(value) + '</div><div class="sub">' + esc(sub || '') + '</div></div>';
}
function rows(dl, pairs) {
  document.getElementById(dl).innerHTML = pairs.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + v + '</dd>').join('');
}

function render(s) {
  const now = s.now;
  const health = document.getElementById('health');
  health.className = 'pill ' + s.health;
  health.lastElementChild.textContent = HEALTH_LABEL[s.health];
  document.getElementById('updated').textContent = 'updated ' + new Date(now).toLocaleTimeString();

  const banner = document.getElementById('banner');
  if (s.health === 'down') {
    const reason = !s.cli.version ? 'Claude CLI is not runnable: ' + (s.cli.error || 'unknown') : (s.lastFailure && s.lastFailure.error) || 'Circuit breaker is open';
    banner.innerHTML = '<div class="banner"><strong>Reviews are not running.</strong><pre>' + esc(reason) + '</pre></div>';
  } else {
    banner.innerHTML = '';
  }

  const sum = key => s.totals.reduce((acc, r) => acc + r[key], 0);
  const reviews = sum('reviews'), failures = sum('failures');
  document.getElementById('tiles').innerHTML = [
    tile('Reviews completed', reviews.toLocaleString(), 'last ' + ago(s.lastSuccess && s.lastSuccess.finishedAt, now)),
    tile('Failed runs', failures.toLocaleString(), 'last ' + ago(s.lastFailure && s.lastFailure.finishedAt, now)),
    tile('Success rate', pct(reviews, reviews + failures), 'of all review runs'),
    tile('LGTM', pct(sum('lgtm'), reviews), sum('lgtm').toLocaleString() + ' reviews with no issues'),
    tile('Issues found', sum('issues').toLocaleString(), (reviews ? (sum('issues') / reviews).toFixed(1) : '—') + ' per review'),
    tile('In queue', (s.waiting.length + (s.running ? 1 : 0)).toString(), s.running ? '1 running' : 'idle'),
  ].join('');

  const breaker = s.circuitBreaker;
  rows('service', [
    ['Claude CLI', s.cli.version ? esc(s.cli.version) : status('failed', 'Missing') + ' <span class="err">' + esc(s.cli.error) + '</span>'],
    ['Auth', esc(s.auth.detail)],
    ...(s.auth.accessTokenExpiresAt ? [['Access token', 'expires ' + esc(new Date(s.auth.accessTokenExpiresAt).toLocaleString())]] : []),
    ['Circuit breaker', breaker.state === 'OPEN' ? status('failed', 'Open') : status('success', breaker.state === 'HALF_OPEN' ? 'Half open' : 'Closed'),],
    ['Consecutive failures', breaker.failureCount + ' / ' + breaker.threshold],
    ['Up since', when(s.processStartedAt, now)],
  ]);

  rows('queue', [
    ['Running', s.running ? prLink(s.running) + ' <span class="muted">(' + esc(s.running.type) + ', started ' + ago(s.running.startedAt, now) + ')</span>' : '<span class="muted">nothing</span>'],
    ['Waiting', s.waiting.length ? s.waiting.map(w => prLink(w) + ' <span class="muted">(' + esc(w.type) + ')</span>').join('<br>') : '<span class="muted">empty</span>'],
    ['Last success', s.lastSuccess ? when(s.lastSuccess.finishedAt, now) + ' · ' + prLink(s.lastSuccess) : '—'],
    ['Last failure', s.lastFailure ? when(s.lastFailure.finishedAt, now) + ' · ' + prLink(s.lastFailure) + '<div class="err">' + esc(s.lastFailure.error) + '</div>' : '—'],
  ]);

  document.getElementById('repos').innerHTML = s.totals.map(r =>
    '<tr><td>' + esc(r.repository) + '</td><td class="num">' + r.prsCreated + '</td><td class="num">' + r.reviews + '</td><td class="num">' + r.failures +
    '</td><td class="num">' + pct(r.reviews, r.reviews + r.failures) + '</td><td class="num">' + r.lgtm + '</td><td class="num">' + r.issues +
    '</td><td class="num">' + (r.durationCount ? secs(r.durationSum / r.durationCount) : '—') + '</td></tr>'
  ).join('') || '<tr><td colspan="8" class="muted">No reviews recorded yet</td></tr>';

  document.getElementById('jobs').innerHTML = s.jobs.map(j => {
    const duration = j.finishedAt ? secs((j.finishedAt - j.startedAt) / 1000) : secs((now - j.startedAt) / 1000);
    const findings = j.status !== 'success' ? '' : j.isLgtm ? 'LGTM' : j.issueCount != null ? j.issueCount + ' issue' + (j.issueCount === 1 ? '' : 's') : '';
    return '<tr><td class="nowrap">' + when(j.startedAt, now) + '</td><td>' + status(j.status, RESULT_LABEL[j.status]) +
      (j.error ? '<div class="err">' + esc(j.error) + '</div>' : '') + '</td><td>' + prLink(j) + '<div class="muted">' + esc(j.author) + '</div></td><td>' +
      esc(j.repository) + '</td><td>' + esc(j.type) + '</td><td>' + (j.triggeredBy ? 'manual · ' + esc(j.triggeredBy) : 'auto') +
      '</td><td class="num">' + duration + '</td><td>' + findings + '</td></tr>';
  }).join('') || '<tr><td colspan="8" class="muted">No jobs since the history was enabled</td></tr>';
}

async function refresh() {
  try {
    const res = await fetch('/api/status');
    render(await res.json());
  } catch (error) {
    document.getElementById('updated').textContent = 'refresh failed: ' + error.message;
  }
}
refresh();
setInterval(refresh, 10000);
</script>
</body>
</html>`;

module.exports = { registerStatusRoutes };
