# Orbix

One chat for many MCP servers. Connect servers, watch their live status in a side panel, ask for anything, download whatever comes back.

- Real accounts (email + password, Google sign-in, password reset) on MongoDB
- Per-user MCP connections (Streamable HTTP, SSE fallback), live status over SSE
- Groq tool-calling agent, with approval before write or destructive tools
- Server catalog is data: add an entry to `catalog/candidates.json`, run `npm run catalog:verify`. Only entries that pass a real connection test land in `catalog/servers.json`.

## Run
```
npm install
npm run build
MONGODB_URI=... JWT_SECRET=... ENC_KEY=... GROQ_API_KEY=... npm start
npm test
```
Optional: `BREVO_API_KEY`, `MAIL_FROM`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_URL`, `GROQ_MODEL`.
