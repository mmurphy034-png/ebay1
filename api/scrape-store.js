const { scrapeStore } = require("../lib/ebay-scraper");
const { upsertStoreSnapshot } = require("../lib/ebay-store-db");

function sendJson(res, statusCode, body) {
  res.status(statusCode).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string" && req.body.trim()) {
    return JSON.parse(req.body);
  }

  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8").trim();
  return rawBody ? JSON.parse(rawBody) : {};
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  try {
    const body = await readJsonBody(req);
    const storeUrl = String(body.storeUrl || "").trim();
    const maxPages = Number(body.maxPages || 3);

    if (!storeUrl) {
      return sendJson(res, 400, { error: "A store URL is required." });
    }

    const scrapeResult = await scrapeStore({
      storeUrl,
      maxPages
    });

    const snapshot = await upsertStoreSnapshot(scrapeResult);

    return sendJson(res, 200, {
      ok: true,
      snapshot
    });
  } catch (error) {
    return sendJson(res, error.statusCode || 500, {
      error: error.message || "Unable to scrape the eBay store."
    });
  }
};