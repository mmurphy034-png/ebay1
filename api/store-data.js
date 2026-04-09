const { readDb } = require("../lib/ebay-store-db");

function sendJson(res, statusCode, body) {
  res.status(statusCode).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  try {
    const url = new URL(req.url, "http://localhost");
    const storeFilter = String(url.searchParams.get("store") || "").trim().toLowerCase();
    const searchQuery = String(url.searchParams.get("q") || "").trim().toLowerCase();
    const db = await readDb();

    const stores = Object.values(db.stores || {})
      .map((store) => {
        const listings = (store.listings || []).filter((listing) => {
          const matchesStore = !storeFilter || store.storeName.toLowerCase().includes(storeFilter);
          const matchesQuery =
            !searchQuery ||
            String(listing.title || "").toLowerCase().includes(searchQuery) ||
            String(listing.itemId || "").toLowerCase().includes(searchQuery) ||
            (listing.condition || "").toLowerCase().includes(searchQuery);

          return matchesStore && matchesQuery;
        });

        return {
          ...store,
          listings
        };
      })
      .filter((store) => store.listings.length || (!storeFilter && !searchQuery))
      .sort((left, right) => new Date(right.scrapedAt || 0) - new Date(left.scrapedAt || 0));

    const totalListings = stores.reduce((sum, store) => sum + (store.listings || []).length, 0);

    return sendJson(res, 200, {
      updatedAt: db.updatedAt || null,
      totalStores: stores.length,
      totalListings,
      stores
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: error.message || "Unable to load the local store database."
    });
  }
};
