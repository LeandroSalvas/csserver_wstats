# AGENTS.md

## Project Overview

CS Server Stats is a Counter-Strike 1.6 server monitoring system with a Node.js/Express API and vanilla JavaScript frontend. The stack includes MariaDB for stats storage, Redis for sessions/cache, and Nginx for serving the web frontend.

## Build/Lint/Test Commands

### API (Node.js)
```bash
# Install dependencies
cd api && npm install

# Run the API
cd api && npm start

# Run with docker (full stack)
docker compose up --build

# Run API container only (if other services are running)
docker compose up --build api
```

### Docker Commands
```bash
# Start full stack
docker compose up --build

# Start in background
docker compose up -d --build

# View logs
docker compose logs -f api
docker compose logs -f web

# Restart a service
docker compose restart api

# Stop all services
docker compose down
```

### Environment Configuration
```bash
# Copy environment template
cp .env.example .env

# Required variables in .env:
# MYSQL_ROOT_PASSWORD, MYSQL_DATABASE, MYSQL_USER, MYSQL_PASSWORD
# DB_HOST (default: db), SESSION_SECRET, SESSION_STORE (redis/memory)
# REDIS_HOST (default: redis), REDIS_PORT (default: 6379)
```

### Port Access
- Frontend: http://localhost:8080
- API via proxy: http://localhost:8080/api
- Health check: http://localhost:8080/api/health

## Code Style Guidelines

### Language & Module System
- Use **CommonJS** (`require()` / `module.exports`)
- No ES modules or TypeScript
- Place API code in `api/index.js` (monolith) or split into `api/routes/`, `api/db/`, etc.

### JavaScript Conventions
- Use `const` and `let`; avoid `var`
- Use **async/await** for asynchronous operations
- Use **arrow functions** for callbacks and inline functions
- Use **template literals** for string interpolation

### Naming Conventions
| Type | Convention | Example |
|------|------------|---------|
| Variables | camelCase | `lastState`, `redisClient` |
| Constants | SCREAMING_SNAKE_CASE | `sessionStoreType` |
| Functions | camelCase, verb prefix | `getCurrentMap()`, `snapshot()` |
| Routes | kebab-case paths | `/top-headshots`, `/map-ranking` |
| SQL tables | snake_case | `csstats`, `csstats_snapshots` |
| SQL columns | snake_case | `kill_streak`, `last_join` |

### SQL Style
- Use **UPPERCASE** for SQL keywords
- Always use **parameterized queries** (`?` placeholders) to prevent SQL injection
- Format multi-line queries with keywords on separate lines for readability

### Error Handling
- Wrap async route handlers in try/catch blocks
- Return appropriate HTTP status codes:
  - `200` for success
  - `400` for bad request (missing required fields)
  - `401` for authentication failures
  - `500` for server errors
- Log errors with `console.error()` including context
- Never expose internal error details to clients in production

### Database Connections
- Use **connection pools** (`mysql.createPool`)
- Use **async/await** with `db.query()` for all queries
- Handle connection failures gracefully (API should still respond even if DB is temporarily down)

### Redis
- Redis is optional (`SESSION_STORE=memory` bypasses it)
- Handle Redis connection failures without crashing the API
- Use reconnection strategies with exponential backoff

### API Routes Structure
```javascript
app.get('/resource', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT ...', [params])
    res.json(rows)
  } catch (err) {
    console.error('Error message:', err)
    res.status(500).json({ error: err.message })
  }
})
```

### Frontend JavaScript (`web/`)
- Vanilla JS only (no frameworks)
- Use `fetch()` for API calls
- Helper functions in `common.js` are shared across pages
- DOM manipulation via `document.getElementById()` and `document.createElement()`
- Event listeners attached after DOM is ready

### File Organization
```
csserver_wstats/
├── api/                  # Node.js API
│   ├── index.js          # Main entry (monolith)
│   ├── package.json
│   └── Dockerfile
├── web/                  # Frontend static files
│   ├── app.js            # Homepage logic
│   ├── common.js         # Shared utilities
│   ├── *.html            # HTML pages
│   └── nginx.conf        # Nginx config
├── config/               # CS server config
├── live/                 # Runtime data files
├── docker-compose.yml
└── .env.example
```

### Comments
- Use comments sparingly in code
- Add comments only when explaining non-obvious business logic or workarounds
- Portuguese comments exist in existing code; match the surrounding context language

### Security
- Never commit `.env` files
- Parameterize all SQL queries
- Use `httpOnly` cookies for sessions
- Validate all user input in route handlers

### Git Workflow
- Commit messages: concise, imperative mood ("Add top-killstreak endpoint")
- Keep commits focused on single changes
- Test changes with `docker compose up --build api` before committing
