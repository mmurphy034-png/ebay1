const fs = require("fs/promises");
const path = require("path");

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "ebay-store-db.json");

function createEmptyDb() {
  return {
    updatedAt: null,
    stores: {}
  };
}

async function ensureDbFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(DB_PATH);
  } catch (error) {
    await fs.writeFile(DB_PATH, JSON.stringify(createEmptyDb(), null, 2), "utf8");
  }
}

async function readDb() {
  await ensureDbFile();
  const raw = await fs.readFile(DB_PATH, "utf8");

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : createEmptyDb();
  } catch (error) {
    return createEmptyDb();
  }
}

async function writeDb(db) {
  await ensureDbFile();

  try {
    await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), "utf8");
  } catch (error) {
    if (error.code === "EROFS") {
      const storageError = new Error(
        "The local database is read-only in this runtime. Use a real database for deployed storage."
      );
      storageError.statusCode = 500;
      throw storageError;
    }

    throw error;
  }
}

function deriveStoreName(urlString) {
  try {
    const url = new URL(urlString);
    const sellerQueryName =
      url.searchParams.get("_ssn") ||
      url.searchParams.get("_saslop") ||
      url.searchParams.get("seller");

    if (sellerQueryName) {
      return sellerQueryName;
    }

    const pathParts = url.pathname.split("/").filter(Boolean);
    return pathParts[pathParts.length - 1] || url.hostname;
  } catch (error) {
    return urlString;
  }
}

function summarizeListings(listings) {
  const prices = listings
    .map((listing) => Number(listing.price))
    .filter((value) => Number.isFinite(value));

  const uniqueConditions = [...new Set(listings.map((listing) => listing.condition).filter(Boolean))];

  return {
    totalListings: listings.length,
    pricedListings: prices.length,
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
    conditions: uniqueConditions
  };
}

async function upsertStoreSnapshot(scrapeResult) {
  const db = await readDb();
  const storeName = deriveStoreName(scrapeResult.normalizedStoreUrl);
  const storeKey = storeName.toLowerCase();
  const scrapedAt = new Date().toISOString();

  db.stores[storeKey] = {
    storeKey,
    storeName,
    storeUrl: scrapeResult.originalStoreUrl,
    normalizedStoreUrl: scrapeResult.normalizedStoreUrl,
    scrapedAt,
    pagesScraped: scrapeResult.pagesScraped,
    maxPagesRequested: scrapeResult.maxPagesRequested,
    discoveredPageCount: scrapeResult.discoveredPageCount,
    summary: summarizeListings(scrapeResult.listings),
    listings: scrapeResult.listings.map((listing) => ({
      ...listing,
      scrapedAt
    }))
  };

  db.updatedAt = scrapedAt;
  await writeDb(db);

  return db.stores[storeKey];
}

module.exports = {
  readDb,
  upsertStoreSnapshot,
  DB_PATH
};
