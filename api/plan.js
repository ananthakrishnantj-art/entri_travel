const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const REQUEST_TIMEOUT_MS = 25_000;

export default async function handler(req, res) {
  setSecurityHeaders(res);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "Server is missing GEMINI_API_KEY." });
  }

  const validation = validateTripInput(parseBody(req.body));
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
    const geminiResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY
      },
      body: JSON.stringify(buildGeminiPayload(validation.data)),
      signal: controller.signal
    });

    const responseJson = await geminiResponse.json().catch(() => ({}));

    if (!geminiResponse.ok) {
      console.error("Gemini error:", responseJson);
      return res.status(502).json({ error: "Gemini could not create the itinerary right now." });
    }

    const plan = responseJson?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
    if (!plan) {
      return res.status(502).json({ error: "Gemini returned an empty plan. Try changing the trip details." });
    }

    return res.status(200).json({ plan, model: GEMINI_MODEL });
  } catch (error) {
    if (error.name === "AbortError") {
      return res.status(504).json({ error: "The planner took too long. Please try a shorter trip." });
    }

    console.error(error);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  } finally {
    clearTimeout(timeout);
  }
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "object") return body;

  try {
    return JSON.parse(body);
  } catch {
    return {};
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

function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}
