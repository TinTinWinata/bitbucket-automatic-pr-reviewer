const express = require('express');
const dotenv = require('dotenv');
const { processPullRequest } = require('./claude');
const { register, metrics } = require('./metrics');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'PR Automation service is running' });
});

// Prometheus metrics endpoint
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    const metricsData = await register.metrics();
    res.end(metricsData);
  } catch (error) {
    console.error('Error collecting metrics:', error);
    res.status(500).end(error.message);
  }
});

// Bitbucket webhook endpoint for PR creation
app.post('/webhook/bitbucket/pr', async (req, res) => {
  try {
    console.log('Received Bitbucket PR webhook');
    console.log('Event:', req.headers['x-event-key']);

    const eventKey = req.headers['x-event-key'];
    
    // Check if it's a PR created event
    if (eventKey !== 'pullrequest:created') {
      return res.status(200).json({ 
        message: 'Event ignored (not a PR creation)',
        event: eventKey 
      });
    }

    const payload = req.body;
    const repository = payload.repository?.name || 'unknown';
    
    // Extract relevant PR information
    const prData = {
      title: payload.pullrequest?.title || 'No title',
      description: payload.pullrequest?.description || 'No description',
      author: payload.pullrequest?.author?.display_name || 'Unknown',
      sourceBranch: payload.pullrequest?.source?.branch?.name || 'Unknown',
      destinationBranch: payload.pullrequest?.destination?.branch?.name || 'Unknown',
      prUrl: payload.pullrequest?.links?.html?.href || 'No URL',
      repository: payload.repository?.name || 'Unknown',
      repoCloneUrl: payload.repository?.links?.clone?.find(link => link.name === 'https')?.href || 
                    payload.repository?.links?.html?.href || 'No clone URL',
    };

    console.log('PR Data:', prData);

    // Track PR metrics based on event type
    if (eventKey === 'pullrequest:created') {
      metrics.prCreatedCounter.inc({ repository });
      console.log(`Metrics: Incremented PR created counter for ${repository}`);
    } else if (eventKey === 'pullrequest:updated') {
      metrics.prUpdatedCounter.inc({ repository });
      console.log(`Metrics: Incremented PR updated counter for ${repository}`);
    }

    // Acknowledge receipt immediately
    res.status(200).json({ 
      message: 'Webhook received successfully',
      prTitle: prData.title
    });

    // Process with Claude asynchronously
    processPullRequest(prData).catch(error => {
      console.error('Error processing PR with Claude:', error);
    });

  } catch (error) {
    console.error('Error handling webhook:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`PR Automation server listening on port ${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhook/bitbucket/pr`);
});

