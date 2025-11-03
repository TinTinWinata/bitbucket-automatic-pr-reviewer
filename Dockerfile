# Use Node.js 20+ for MCP server compatibility
FROM node:20-alpine

# Install git and bash for Claude CLI shell requirements
RUN apk add --no-cache git bash

# Install Claude CLI globally
RUN npm install -g @anthropic-ai/claude-code && \
    npm cache clean --force

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (skip prepare script to avoid husky issues)
RUN npm install --production --ignore-scripts && \
    npm cache clean --force

# Create projects directory
RUN mkdir -p /app/projects

# Copy application files
COPY src ./src
COPY docker-entrypoint.sh /usr/local/bin/

# Change ownership of the app directory to the node user (already exists in base image)
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && \
    chown -R node:node /app

# Set shell environment for Claude CLI
ENV SHELL=/bin/bash

# Switch to non-root user
USER node

# Expose port
EXPOSE 3000

# Set entrypoint
ENTRYPOINT ["docker-entrypoint.sh"]

# Start the application
CMD ["npm", "start"]