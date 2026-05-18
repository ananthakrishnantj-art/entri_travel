import http from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");

loadDotEnv();

const PORT = Number(process.env.PORT || 3000);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const MAX_BODY_BYTES = 12_000;
const REQUEST_TIMEOUT_MS = 25_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 12;
const rateLimitStore = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

const server = http.createServer(async (req, res) => {
  setSecurityHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "POST" && url.pathname === "/api/plan") {
      await handlePlanRequest(req, res);
      return;
    }

    if (req.method === "GET") {
      await serveStatic(url.pathname, res);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed." });
  } catch (error) {
    if (error.statusCode) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }
    console.error(error);
    sendJson(res, 500, { error: "Something went wrong. Please try again." });
  }
});

server.listen(PORT, () => {
  console.log(`Travel Planner running at http://localhost:${PORT}`);
  if (!GEMINI_API_KEY) {
    console.warn("GEMINI_API_KEY is missing. Add it to .env before generating plans.");
  }
});

async function handlePlanRequest(req, res) {
  const clientIp = getClientIp(req);
  if (!allowRequest(clientIp)) {
    sendJson(res, 429, { error: "Too many requests. Please wait a minute and try again." });
    return;
  }

  if (!GEMINI_API_KEY) {
    sendJson(res, 500, { error: "Server is missing GEMINI_API_KEY. Add it to .env and restart." });
    return;
  }

  const body = await readJsonBody(req);
  const validation = validateTripInput(body);
  if (!validation.ok) {
    sendJson(res, 400, { error: validation.error });
    return;
  }

  const payload = buildGeminiPayload(validation.data);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const geminiResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const responseJson = await geminiResponse.json().catch(() => ({}));

    if (!geminiResponse.ok) {
      console.error("Gemini error:", responseJson);
      sendJson(res, 502, { error: "Gemini could not create the itinerary right now." });
      return;
    }

    const text = responseJson?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
    if (!text) {
      sendJson(res, 502, { error: "Gemini returned an empty plan. Try changing the trip details." });
      return;
    }

    sendJson(res, 200, { plan: text, model: GEMINI_MODEL });
  } catch (error) {
    if (error.name === "AbortError") {
      sendJson(res, 504, { error: "The planner took too long. Please try a shorter trip." });
      return;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildGeminiPayload(trip) {
  const prompt = `
Create a practical, safe travel itinerary using the details below.

Destination: ${trip.destination}
Starting city: ${trip.startingCity}
Days: ${trip.days}
Group size: ${trip.groupSize}
Budget level: ${trip.budget}
Trip type: ${trip.tripType || "general sightseeing"}
Interests or notes: ${trip.notes || "none"}

Return a clean plan in Markdown with:
1. A short trip summary.
2. Day-by-day itinerary with morning, afternoon, and evening.
3. Food or local experience suggestions.
4. Budget tips suitable for the selected budget.
5. Safety and practical notes.

Do not invent emergency phone numbers, visa rules, medical advice, or live prices. If live details may change, tell the user to verify them before booking.
`.trim();

  return {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }]
      }
    ],
    systemInstruction: {
      parts: [
        {
          text: "You are a careful AI travel planner. Give helpful itinerary ideas, avoid risky recommendations, and clearly label information the user should verify before booking."
        }
      ]
    },
    generationConfig: {
      temperature: 0.7,
      topP: 0.9,
      maxOutputTokens: 4500
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
    ]
  };
}

function validateTripInput(input) {
  const destination = cleanText(input?.destination, 80);
  const startingCity = cleanText(input?.startingCity, 80);
  const budget = cleanText(input?.budget, 20);
  const tripType = cleanText(input?.tripType, 40);
  const notes = cleanText(input?.notes, 500);
  const days = Number(input?.days);
  const groupSize = Number(input?.groupSize);

  if (!destination) return { ok: false, error: "Destination is required." };
  if (!startingCity) return { ok: false, error: "Starting city is required." };
  if (!Number.isInteger(days) || days < 1 || days > 30) {
    return { ok: false, error: "Days must be a whole number from 1 to 30." };
  }
  if (!Number.isInteger(groupSize) || groupSize < 1 || groupSize > 50) {
    return { ok: false, error: "Group size must be a whole number from 1 to 50." };
  }
  if (!["low", "medium", "high"].includes(budget)) {
    return { ok: false, error: "Choose a valid budget level." };
  }

  return {
    ok: true,
    data: { destination, startingCity, days, groupSize, budget, tripType, notes }
  };
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

async function readJsonBody(req) {
  let size = 0;
  const chunks = [];

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, "Request body is too large.");
    }
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  try {
    return rawBody ? JSON.parse(rawBody) : {};
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

async function serveStatic(pathname, res) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const normalizedPath = normalize(decodeURIComponent(requestedPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, normalizedPath);

  if (!filePath.startsWith(publicDir)) {
    sendJson(res, 403, { error: "Forbidden." });
    return;
  }

  try {
    const file = await readFile(filePath);
    res.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream" });
    res.end(file);
  } catch {
    const file = await readFile(join(publicDir, "index.html"));
    res.writeHead(200, { "Content-Type": mimeTypes[".html"] });
    res.end(file);
  }
}

function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'");
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function allowRequest(clientIp) {
  const now = Date.now();
  const existing = rateLimitStore.get(clientIp);

  if (!existing || now > existing.resetAt) {
    rateLimitStore.set(clientIp, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  existing.count += 1;
  return existing.count <= RATE_LIMIT_MAX;
}

function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string") return forwardedFor.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function loadDotEnv() {
  try {
    const envPath = join(__dirname, ".env");
    const envText = readFileSync(envPath, "utf8");
    for (const line of envText.split(/\r?\n/)) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (!match || match[1].startsWith("#")) continue;
      const key = match[1];
      const value = match[2].replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env is optional. Production hosts should use real environment variables.
  }
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}
