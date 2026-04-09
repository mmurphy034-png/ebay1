const scrapeForm = document.getElementById("scrapeForm");
const storeUrlInput = document.getElementById("storeUrl");
const maxPagesInput = document.getElementById("maxPages");
const storeFilterInput = document.getElementById("storeFilter");
const searchInput = document.getElementById("searchInput");
const statusMessage = document.getElementById("statusMessage");
const summaryCards = document.getElementById("summaryCards");
const storeCards = document.getElementById("storeCards");
const listingTable = document.getElementById("listingTable");

let databaseState = {
  stores: []
};

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(value) {
  if (!value) {
    return "--";
  }

  return new Date(value).toLocaleString();
}

function formatPrice(value, currency = "USD") {
  if (value === null || value === undefined || value === "") {
    return "--";
  }

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 2
  }).format(Number(value));
}

function setStatus(message, tone = "neutral") {
  statusMessage.textContent = message;
  statusMessage.dataset.tone = tone;
}

function flattenListings(stores) {
  return stores.flatMap((store) =>
    (store.listings || []).map((listing) => ({
      ...listing,
      storeName: store.storeName
    }))
  );
}

function filteredStores() {
  const storeFilter = storeFilterInput.value.trim().toLowerCase();
  const query = searchInput.value.trim().toLowerCase();

  return (databaseState.stores || [])
    .map((store) => {
      const matchesStore = !storeFilter || store.storeName.toLowerCase().includes(storeFilter);

      const listings = (store.listings || []).filter((listing) => {
        if (!query) {
          return true;
        }

        return [listing.title, listing.itemId, listing.condition, listing.location]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query));
      });

      return matchesStore ? { ...store, listings } : null;
    })
    .filter(Boolean);
}

function renderSummary(stores) {
  const listings = flattenListings(stores);
  const prices = listings.map((listing) => Number(listing.price)).filter((value) => Number.isFinite(value));

  const cards = [
    {
      label: "Stores captured",
      value: String(stores.length)
    },
    {
      label: "Listings in view",
      value: String(listings.length)
    },
    {
      label: "Lowest price",
      value: prices.length ? formatPrice(Math.min(...prices)) : "--"
    },
    {
      label: "Latest sync",
      value: databaseState.updatedAt ? formatDate(databaseState.updatedAt) : "--"
    }
  ];

  summaryCards.innerHTML = cards
    .map(
      (card) => `
        <article class="metric-card">
          <p>${escapeHtml(card.label)}</p>
          <strong>${escapeHtml(card.value)}</strong>
        </article>
      `
    )
    .join("");
}

function renderStores(stores) {
  if (!stores.length) {
    storeCards.innerHTML = `<div class="empty-state">No store snapshots yet. Run a scrape to build the database.</div>`;
    return;
  }

  storeCards.innerHTML = stores
    .map(
      (store) => `
        <article class="store-card">
          <div class="store-card-top">
            <div>
              <p class="eyebrow">Store</p>
              <h3>${escapeHtml(store.storeName)}</h3>
            </div>
            <span class="pill">${escapeHtml(String(store.summary?.totalListings || 0))} listings</span>
          </div>
          <p class="store-meta">
            Pages scraped: ${escapeHtml(String(store.pagesScraped || 0))} of ${escapeHtml(String(store.discoveredPageCount || 0))}
          </p>
          <p class="store-meta">
            Price range: ${escapeHtml(formatPrice(store.summary?.minPrice))} to ${escapeHtml(formatPrice(store.summary?.maxPrice))}
          </p>
          <p class="store-meta">
            Updated: ${escapeHtml(formatDate(store.scrapedAt))}
          </p>
          <a class="store-link" href="${escapeHtml(store.normalizedStoreUrl)}" target="_blank" rel="noreferrer">Open source store</a>
        </article>
      `
    )
    .join("");
}

function renderListings(stores) {
  const listings = flattenListings(stores);

  if (!listings.length) {
    listingTable.innerHTML = `<div class="empty-state">No listings match the current filters.</div>`;
    return;
  }

  listingTable.innerHTML = `
    <div class="table-head">
      <span>Item</span>
      <span>Store</span>
      <span>Price</span>
      <span>Condition</span>
      <span>Location</span>
      <span>Page</span>
    </div>
    ${listings
      .map(
        (listing) => `
          <article class="table-row">
            <div class="listing-cell listing-main">
              <img class="listing-image" src="${escapeHtml(listing.imageUrl || "")}" alt="" />
              <div>
                ${
                  listing.itemUrl
                    ? `<a class="listing-link" href="${escapeHtml(listing.itemUrl)}" target="_blank" rel="noreferrer">
                         ${escapeHtml(listing.title)}
                       </a>`
                    : `<span class="listing-link">${escapeHtml(listing.title)}</span>`
                }
                <p class="listing-subtle">Item ID: ${escapeHtml(listing.itemId || "--")}</p>
              </div>
            </div>
            <div class="listing-cell">${escapeHtml(listing.storeName || "--")}</div>
            <div class="listing-cell">${escapeHtml(formatPrice(listing.price, listing.currency))}</div>
            <div class="listing-cell">${escapeHtml(listing.condition || "--")}</div>
            <div class="listing-cell">${escapeHtml(listing.location || "--")}</div>
            <div class="listing-cell">${escapeHtml(String(listing.sourcePage || "--"))}</div>
          </article>
        `
      )
      .join("")}
  `;
}

function renderDatabase(payload) {
  databaseState = payload;
  const stores = filteredStores();
  renderSummary(stores);
  renderStores(stores);
  renderListings(stores);
}

async function loadDatabase() {
  const response = await fetch("/api/store-data");
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Unable to load the eBay store database.");
  }

  renderDatabase(payload);
}

async function scrapeStore(event) {
  event.preventDefault();
  const storeUrl = storeUrlInput.value.trim();
  const maxPages = Number(maxPagesInput.value || 3);

  if (!storeUrl) {
    setStatus("Enter an eBay store URL first.", "error");
    return;
  }

  setStatus("Scraping store pages and saving listings to the local database...", "working");

  const response = await fetch("/api/scrape-store", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      storeUrl,
      maxPages
    })
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Unable to scrape this store.");
  }

  setStatus(
    `Saved ${payload.snapshot.summary.totalListings} listings for ${payload.snapshot.storeName}.`,
    "success"
  );

  await loadDatabase();
}

scrapeForm.addEventListener("submit", (event) => {
  scrapeStore(event).catch((error) => {
    setStatus(error.message, "error");
  });
});

[storeFilterInput, searchInput].forEach((input) => {
  input.addEventListener("input", () => {
    renderDatabase(databaseState);
  });
});

loadDatabase()
  .then(() => {
    setStatus("Ready to capture an eBay store.", "neutral");
  })
  .catch((error) => {
    setStatus(error.message, "error");
  });
