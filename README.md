# AI Travel Planner with Gemini Flash-Lite

A simple full-stack travel planner. The frontend collects trip details, and the backend safely calls the Gemini API so your API key never reaches the browser.

## Run locally

1. Copy `.env.example` to `.env`.
2. Add your Gemini API key:

```env
GEMINI_API_KEY=your_google_ai_studio_key_here
GEMINI_MODEL=gemini-2.5-flash-lite
PORT=3000
```

3. Start the app:

```bash
npm start
```

4. Open `http://localhost:3000`.

## Deploy on Vercel

Add these environment variables in Vercel Project Settings:

```env
GEMINI_API_KEY=your_google_ai_studio_key_here
GEMINI_MODEL=gemini-2.5-flash-lite
```

The deployed frontend calls `/api/plan`, which is handled by `api/plan.js` as a Vercel serverless function.

## Safety choices

- API key stays in `.env` on the backend.
- No dependencies are required for the basic server.
- User input is validated and length-limited before being sent to Gemini.
- Basic rate limiting is included per client IP.
- Security headers and a restrictive Content Security Policy are set.
- Gemini safety settings are enabled.
- The prompt tells Gemini not to invent live prices, visa rules, emergency numbers, or medical advice.
