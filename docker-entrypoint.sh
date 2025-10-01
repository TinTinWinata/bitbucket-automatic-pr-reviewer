#!/bin/sh
set -e

# Get the home directory (works for both root and non-root users)
HOME_DIR=$(eval echo ~$(whoami))

# Configure Git credentials for Bitbucket
if [ -n "$BITBUCKET_USER" ] && [ -n "$BITBUCKET_TOKEN" ]; then
    echo "Configuring Git credentials with username and app password..."
    
    # Configure Git credential helper using URL-specific insteadOf
    # Bitbucket app passwords require username:token format
    git config --global url."https://${BITBUCKET_USER}:${BITBUCKET_TOKEN}@bitbucket.org".insteadOf "https://bitbucket.org"
    
    # Also disable interactive credential prompts
    git config --global core.askPass ""
    git config --global credential.helper ""
    
    echo "Git credentials configured successfully (username:token format)"
elif [ -n "$BITBUCKET_TOKEN" ]; then
    echo "Configuring Git credentials with Bitbucket token only..."
    
    # For repository access tokens (not app passwords)
    git config --global url."https://x-token-auth:${BITBUCKET_TOKEN}@bitbucket.org".insteadOf "https://bitbucket.org"
    
    # Also disable interactive credential prompts
    git config --global core.askPass ""
    git config --global credential.helper ""
    
    echo "Git credentials configured successfully (x-token-auth format)"
elif [ -n "$BITBUCKET_USER" ] && [ -n "$BITBUCKET_PASSWORD" ]; then
    echo "Configuring Git credentials with username/password..."
    
    # Configure Git credential helper using URL-specific insteadOf
    git config --global url."https://${BITBUCKET_USER}:${BITBUCKET_PASSWORD}@bitbucket.org".insteadOf "https://bitbucket.org"
    
    # Also disable interactive credential prompts
    git config --global core.askPass ""
    git config --global credential.helper ""
    
    echo "Git credentials configured successfully (username:password format)"
else
    echo "Warning: No Bitbucket credentials provided. Git operations may require authentication."
fi

echo "Running as user: $(whoami) (UID: $(id -u))"

# Ensure shell environment is properly set for Claude CLI
export SHELL=/bin/bash
echo "Shell environment: $SHELL"

# Also set the shell for the node user's profile
echo 'export SHELL=/bin/bash' >> /home/node/.bashrc 2>/dev/null || true
echo 'export SHELL=/bin/bash' >> /home/node/.profile 2>/dev/null || true

# Execute the main command
exec "$@"

