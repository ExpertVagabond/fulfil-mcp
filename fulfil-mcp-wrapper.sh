#!/bin/bash
# fulfil-mcp wrapper for Claude Code MCP config
# Loads credentials and runs the MCP server via stdio

# Credential sources (in priority order):
# 1. Already-set environment variables
# 2. Credential files in the vault
# 3. Hardcoded fallback (edit these if not using vault)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VAULT_DIR="/Volumes/Virtual Server/configs/credentials/fulfil"

# Load API key from vault if not already set
if [ -z "$FULFIL_API_KEY" ] && [ -f "$VAULT_DIR/api-key" ]; then
  export FULFIL_API_KEY="$(cat "$VAULT_DIR/api-key")"
fi

# Load subdomain from vault if not already set
if [ -z "$FULFIL_SUBDOMAIN" ] && [ -f "$VAULT_DIR/subdomain" ]; then
  export FULFIL_SUBDOMAIN="$(cat "$VAULT_DIR/subdomain")"
fi

# Validate
if [ -z "$FULFIL_API_KEY" ]; then
  echo "Error: FULFIL_API_KEY not set. Set it in env or create $VAULT_DIR/api-key" >&2
  exit 1
fi

if [ -z "$FULFIL_SUBDOMAIN" ]; then
  echo "Error: FULFIL_SUBDOMAIN not set. Set it in env or create $VAULT_DIR/subdomain" >&2
  exit 1
fi

exec node "$SCRIPT_DIR/dist/index.js"
