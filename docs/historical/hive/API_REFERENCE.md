# API Reference

## Overview

The AI Agent Development Environment Manager provides multiple API interfaces for interacting with the system. This document covers the GraphQL API, WebSocket channels, CLI commands, and configuration file formats.

## GraphQL API

### Base URL
- **Development**: `http://localhost:4000/graphql`
- **Production**: `https://your-domain.com/graphql`

### Authentication

All GraphQL requests require authentication via JWT token in the Authorization header:

```
Authorization: Bearer <jwt_token>
```

### Schema Overview

```graphql
type Query {
  # Agent queries
  getAgent(id: ID!): Agent
  listAgents(filter: AgentFilter, sort: AgentSort): [Agent!]!

  # Template queries
  getTemplate(key: String!): Template
  listTemplates: [Template!]!

  # Service queries
  getServiceHealth(agentId: ID!, serviceName: String!): ServiceHealth
  listServices(agentId: ID!): [Service!]!

  # System queries
  getSystemStatus: SystemStatus!
}

type Mutation {
  # Agent management
  createAgent(input: CreateAgentInput!): Agent!
  updateAgent(id: ID!, input: UpdateAgentInput!): Agent!
  deleteAgent(id: ID!): Boolean!

  # Agent lifecycle
  startAgent(id: ID!): Agent!
  stopAgent(id: ID!): Agent!
  restartAgent(id: ID!): Agent!

  # Agent feedback states
  beginWork(id: ID!, description: String): Agent!
  completeWork(id: ID!, summary: String): Agent!
  requestInput(id: ID!, prompt: String!): Agent!
  provideInput(id: ID!, response: String!): Agent!

  # Terminal management
  connectTerminal(agentId: ID!): TerminalSession!
  disconnectTerminal(sessionId: ID!): Boolean!

  # Service management
  restartService(agentId: ID!, serviceName: String!): Service!

  # Template management
  validateTemplate(template: TemplateInput!): TemplateValidation!
}

type Subscription {
  # Agent updates
  agentUpdated(id: ID!): Agent!
  agentStateChanged(id: ID!): AgentStateChange!

  # Service updates
  serviceHealthChanged(agentId: ID!): ServiceHealth!

  # System notifications
  systemNotification: SystemNotification!
}
```

### Types

#### Agent

```graphql
type Agent {
  id: ID!
  name: String!
  description: String
  state: AgentState!
  feedbackState: FeedbackState!
  templateKey: String!
  worktreePath: String
  tmuxSessionName: String
  branchName: String

  # Relationships
  ports: [Port!]!
  services: [Service!]!
  chatMessages: [ChatMessage!]!

  # Computed fields
  resourceUsage: ResourceUsage!
  serviceStatus: ServiceStatus!
  healthStatus: HealthStatus!

  # Timestamps
  createdAt: DateTime!
  updatedAt: DateTime!
}

enum AgentState {
  SPAWNING
  RUNNING
  STOPPING
  STOPPED
  ERROR
}

enum FeedbackState {
  READY
  WORKING
  AWAITING_INPUT
  VALIDATING
  ERROR
}
```

#### Template

```graphql
type Template {
  key: String!
  name: String!
  description: String
  extends: String

  services: [TemplateService!]!
  externalServices: [ExternalService!]!
  environment: [EnvironmentVariable!]!
  mcpServers: [MCPServer!]!

  codeAssistant: String
  promptConfig: PromptConfig
}

type TemplateService {
  name: String!
  command: String!
  portType: PortType!
  healthCheck: String
  environment: [EnvironmentVariable!]!
  dependsOn: [String!]!
  restartPolicy: RestartPolicy!
}

enum PortType {
  BACKEND
  FRONTEND
  DATABASE
  CACHE
  CUSTOM
}

enum RestartPolicy {
  ALWAYS
  ON_FAILURE
  NO
}
```

#### Service

```graphql
type Service {
  name: String!
  agentId: ID!
  status: ServiceStatus!
  port: Int
  pid: Int

  # Health information
  healthy: Boolean!
  lastHealthCheck: DateTime
  healthCheckUrl: String

  # Resource usage
  cpuUsage: Float
  memoryUsage: Int

  # Configuration
  command: String!
  environment: [EnvironmentVariable!]!

  # Timestamps
  startedAt: DateTime
  lastRestart: DateTime
}

enum ServiceStatus {
  STARTING
  RUNNING
  STOPPING
  STOPPED
  ERROR
  RESTARTING
}
```

### Queries

#### Get Agent

```graphql
query GetAgent($id: ID!) {
  getAgent(id: $id) {
    id
    name
    description
    state
    feedbackState
    templateKey

    ports {
      port
      type
      serviceName
    }

    services {
      name
      status
      healthy
      port
      cpuUsage
      memoryUsage
    }

    resourceUsage {
      cpu
      memory
      disk
    }

    createdAt
    updatedAt
  }
}
```

**Variables:**
```json
{
  "id": "agent-uuid-here"
}
```

**Response:**
```json
{
  "data": {
    "getAgent": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "name": "Frontend Development Agent",
      "description": "React development with hot reload",
      "state": "RUNNING",
      "feedbackState": "READY",
      "templateKey": "react_frontend",
      "ports": [
        {
          "port": 3001,
          "type": "FRONTEND",
          "serviceName": "dev_server"
        }
      ],
      "services": [
        {
          "name": "dev_server",
          "status": "RUNNING",
          "healthy": true,
          "port": 3001,
          "cpuUsage": 15.2,
          "memoryUsage": 256000000
        }
      ],
      "resourceUsage": {
        "cpu": 15.2,
        "memory": 256000000,
        "disk": 1024000000
      },
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-15T10:45:00Z"
    }
  }
}
```

#### List Agents

```graphql
query ListAgents($filter: AgentFilter, $sort: AgentSort) {
  listAgents(filter: $filter, sort: $sort) {
    id
    name
    state
    feedbackState
    templateKey
    createdAt

    services {
      name
      status
      healthy
    }
  }
}
```

**Variables:**
```json
{
  "filter": {
    "state": ["RUNNING", "SPAWNING"],
    "templateKey": "react_frontend"
  },
  "sort": {
    "field": "CREATED_AT",
    "direction": "DESC"
  }
}
```

### Mutations

#### Create Agent

```graphql
mutation CreateAgent($input: CreateAgentInput!) {
  createAgent(input: $input) {
    id
    name
    state
    templateKey
    worktreePath
    tmuxSessionName

    ports {
      port
      type
      serviceName
    }
  }
}
```

**Variables:**
```json
{
  "input": {
    "name": "My New Agent",
    "description": "Development agent for feature X",
    "templateKey": "fullstack_web"
  }
}
```

#### Update Agent Feedback State

```graphql
mutation BeginWork($id: ID!, $description: String) {
  beginWork(id: $id, description: $description) {
    id
    feedbackState
    updatedAt
  }
}
```

**Variables:**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "description": "Working on user authentication feature"
}
```

### Subscriptions

#### Agent Updates

```graphql
subscription AgentUpdated($id: ID!) {
  agentUpdated(id: $id) {
    id
    state
    feedbackState

    services {
      name
      status
      healthy
    }
  }
}
```

**Variables:**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000"
}
```

## WebSocket Channels

### Connection

Connect to WebSocket endpoint:
- **URL**: `ws://localhost:4000/socket`
- **Protocol**: Phoenix Channel Protocol

### Authentication

Include authentication token when joining channels:

```javascript
const socket = new Socket("ws://localhost:4000/socket", {
  params: { token: userToken }
});
```

### Available Channels

#### Agent Channel

**Topic**: `agent:<agent_id>`

**Join Parameters:**
```javascript
channel.join("agent:123e4567-e89b-12d3-a456-426614174000", {})
```

**Events:**

- **`state_changed`**: Agent state transitions
- **`feedback_updated`**: Feedback state changes
- **`health_updated`**: Service health changes
- **`resource_updated`**: Resource usage updates

**Example:**
```javascript
channel.on("state_changed", payload => {
  console.log(`Agent ${payload.agent_id} state: ${payload.state}`);
});

channel.on("feedback_updated", payload => {
  console.log(`Agent feedback: ${payload.feedback_state}`);
});
```

#### Terminal Channel

**Topic**: `terminal:<session_id>`

**Join Parameters:**
```javascript
channel.join("terminal:session_123", {
  token: terminalToken
})
```

**Events:**

- **`output`**: Terminal output data
- **`error`**: Terminal errors
- **`exit`**: Terminal session ended

**Messages:**

- **`input`**: Send input to terminal
- **`resize`**: Resize terminal

**Example:**
```javascript
// Receive terminal output
channel.on("output", ({ data }) => {
  terminal.write(data);
});

// Send input to terminal
channel.push("input", { data: "npm run dev\n" });

// Resize terminal
channel.push("resize", { cols: 80, rows: 24 });
```

#### System Notifications Channel

**Topic**: `notifications:<user_id>`

**Events:**

- **`agent_notification`**: Agent-related notifications
- **`system_notification`**: System-wide notifications
- **`error_notification`**: Error notifications

## CLI Commands

### Global Commands

#### hive

Start the agent development environment manager:

```bash
hive [options]
hive start [options]
```

**Options:**
- `--port, -p <port>`: Server port (default: 4000)
- `--config, -c <file>`: Configuration file path
- `--verbose, -v`: Verbose output

**Examples:**
```bash
hive                    # Start with defaults
hive --port 4001        # Start on custom port
hive -c ./my-hive.json  # Use custom config
```

#### hive stop

Stop the local server:

```bash
hive stop [options]
```

**Options:**
- `--force, -f`: Force stop without graceful shutdown

#### hive status

Show server and agent status:

```bash
hive status [options]
```

**Options:**
- `--format <format>`: Output format (table, json, yaml)

### Agent Management

#### hive agents list

List all agents:

```bash
hive agents list [options]
```

**Options:**
- `--state <state>`: Filter by state (running, stopped, error)
- `--template <key>`: Filter by template
- `--format <format>`: Output format (table, json, yaml)

**Example:**
```bash
hive agents list --state running --format json
```

#### hive agents create

Create a new agent:

```bash
hive agents create <template> <name> [options]
```

**Arguments:**
- `<template>`: Template key to use
- `<name>`: Agent name

**Options:**
- `--description <desc>`: Agent description
- `--start`: Start agent immediately after creation

**Example:**
```bash
hive agents create fullstack_web "My API Agent" --description "Backend API development" --start
```

#### hive agents start

Start an agent:

```bash
hive agents start <agent-id> [options]
```

**Options:**
- `--wait`: Wait for agent to be fully started
- `--timeout <seconds>`: Timeout for waiting

#### hive agents stop

Stop an agent:

```bash
hive agents stop <agent-id> [options]
```

**Options:**
- `--force`: Force stop without graceful shutdown

#### hive agents connect

Connect to an agent's terminal:

```bash
hive agents connect <agent-id> [options]
```

**Options:**
- `--service <name>`: Connect to specific service pane
- `--new-window`: Create new tmux window

### Template Management

#### hive templates list

List available templates:

```bash
hive templates list [options]
```

**Options:**
- `--format <format>`: Output format (table, json, yaml)

#### hive templates validate

Validate a template configuration:

```bash
hive templates validate [file] [options]
```

**Arguments:**
- `[file]`: Template file to validate (default: hive.json)

**Options:**
- `--strict`: Enable strict validation mode

#### hive templates create

Create a new template:

```bash
hive templates create <name> [options]
```

**Options:**
- `--extends <template>`: Base template to extend
- `--interactive`: Interactive template creation

### Configuration

#### hive config init

Initialize configuration in current directory:

```bash
hive config init [options]
```

**Options:**
- `--template <template>`: Include example template
- `--force`: Overwrite existing configuration

#### hive config validate

Validate current configuration:

```bash
hive config validate [file] [options]
```

#### hive config schema

Export JSON schema for configuration:

```bash
hive config schema [options]
```

**Options:**
- `--output <file>`: Output file (default: .hive/hive-config.schema.json)
- `--force`: Overwrite existing file

### Desktop Application

#### hive desktop

Launch desktop application:

```bash
hive desktop [options]
```

**Options:**
- `--no-server`: Don't start backend server
- `--dev`: Development mode

### Logs and Debugging

#### hive logs

Show system logs:

```bash
hive logs [options]
```

**Options:**
- `--follow, -f`: Follow log output
- `--agent <id>`: Show logs for specific agent
- `--service <name>`: Show logs for specific service
- `--level <level>`: Filter by log level

### System Management

#### hive uninstall

Uninstall the system:

```bash
hive uninstall [options]
```

**Options:**
- `--force`: Skip confirmation prompt
- `--keep-data`: Keep user data and configurations

## Configuration File Format

### hive.json Schema

```json
{
  "$schema": ".hive/hive-config.schema.json",
  "templates": {
    "template_key": {
      "name": "Template Name",
      "description": "Template description",
      "extends": "base_template",

      "services": {
        "service_name": {
          "command": "npm run dev",
          "port_type": "frontend",
          "health_check": "/health",
          "environment": {
            "NODE_ENV": "development"
          },
          "depends_on": ["database"],
          "restart_policy": "on-failure",
          "working_directory": "{{worktree_path}}"
        }
      },

      "external_services": {
        "database": {
          "image": "postgres:15",
          "ports": {
            "5432": "database"
          },
          "environment": {
            "POSTGRES_DB": "app_dev",
            "POSTGRES_USER": "developer",
            "POSTGRES_PASSWORD": "secret"
          },
          "volumes": [
            "postgres_data:/var/lib/postgresql/data"
          ],
          "health_check": {
            "test": ["CMD-SHELL", "pg_isready -U developer"],
            "interval": "10s",
            "timeout": "5s",
            "retries": 5
          }
        }
      },

      "docker_compose": "docker/development.yml",

      "environment": {
        "LOG_LEVEL": "debug",
        "DEBUG": "app:*"
      },

      "mcp": {
        "servers": {
          "filesystem": {
            "command": "npx @modelcontextprotocol/server-filesystem",
            "args": ["--root", "{{worktree_path}}"],
            "env": {
              "LOG_LEVEL": "info"
            },
            "startup_timeout_ms": 30000
          }
        }
      },

      "code_assistant": "claude",

      "prompt_config": {
        "system_prompt": "You are a helpful development assistant.",
        "context_files": [
          "package.json",
          "src/**/*.ts",
          "docs/api.md"
        ],
        "ignore_patterns": [
          "node_modules/**",
          "dist/**",
          "*.log"
        ],
        "max_context_size": 50000,
        "include_git_status": true,
        "include_recent_commits": 5
      }
    }
  },

  "defaults": {
    "code_assistant": "claude",
    "restart_policy": "on-failure",
    "resource_limits": {
      "memory": "1G",
      "cpu": "0.5"
    }
  }
}
```

### Environment File Format

Agent-specific environment files (`.env.agent`):

```bash
# Agent Environment Variables
AGENT_ID=123e4567-e89b-12d3-a456-426614174000
WORKTREE_PATH=/project/.hive/worktrees/123e4567-e89b-12d3-a456-426614174000
TMUX_SESSION=agent-123e4567-e89b-12d3-a456-426614174000

# Service Ports
BACKEND_PORT=4001
FRONTEND_PORT=3001
DATABASE_PORT=5432

# Service URLs
BACKEND_URL=http://localhost:4001
FRONTEND_URL=http://localhost:3001
DATABASE_URL=postgresql://developer:secret@localhost:5432/app_dev

# Template Environment
NODE_ENV=development
LOG_LEVEL=debug
DEBUG=app:*
```

## Error Responses

### GraphQL Errors

```json
{
  "errors": [
    {
      "message": "Agent not found",
      "locations": [{"line": 2, "column": 3}],
      "path": ["getAgent"],
      "extensions": {
        "code": "NOT_FOUND",
        "details": {
          "agent_id": "invalid-id"
        }
      }
    }
  ],
  "data": {
    "getAgent": null
  }
}
```

### Common Error Codes

- `NOT_FOUND`: Resource not found
- `VALIDATION_ERROR`: Input validation failed
- `PERMISSION_DENIED`: Insufficient permissions
- `RESOURCE_CONFLICT`: Resource conflict (e.g., port already in use)
- `TEMPLATE_ERROR`: Template configuration error
- `SERVICE_ERROR`: Service startup/management error
- `NETWORK_ERROR`: Network connectivity issue

### CLI Error Codes

- `0`: Success
- `1`: General error
- `2`: Invalid usage/arguments
- `3`: Configuration error
- `4`: Network error
- `5`: Permission error
- `6`: Resource not found

## Rate Limits

### GraphQL API

- **Queries**: 1000 requests per minute per user
- **Mutations**: 100 requests per minute per user
- **Subscriptions**: 50 concurrent connections per user

### WebSocket Channels

- **Messages**: 1000 messages per minute per channel
- **Terminal Input**: 10KB per second per terminal session

### CLI Commands

- **Agent Operations**: 10 operations per minute
- **Template Validation**: 100 validations per minute

This comprehensive API reference provides all the information needed to interact with the AI Agent Development Environment Manager through its various interfaces.