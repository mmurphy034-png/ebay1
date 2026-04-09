const DEFAULT_HEADERS = {
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
};

function decodeHtml(value) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function normalizeStoreUrl(input) {
  const raw = String(input || "").trim();
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(candidate);

  if (!url.hostname.toLowerCase().includes("ebay.")) {
    const error = new Error("The URL must point to an eBay store or seller page.");
    error.statusCode = 400;
    throw error;
  }

  ["_pgn", "_ipg", "rt", "mkcid", "mkevt", "mkrid", "campid", "customid"].forEach((key) =>
    url.searchParams.delete(key)
  );

  return url.toString();
}

function buildPagedUrl(storeUrl, pageNumber) {
  const url = new URL(storeUrl);
  url.searchParams.set("_pgn", String(pageNumber));
  url.searchParams.set("_ipg", "240");
  return url.toString();
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: DEFAULT_HEADERS,
    redirect: "follow"
  });

  if (!response.ok) {
    const error = new Error(`eBay returned status ${response.status} for ${url}`);
    error.statusCode = response.status;
    throw error;
  }

  return response.text();
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  return value ? [value] : [];
}

function firstPrice(offers) {
  const offerList = toArray(offers);

  for (const offer of offerList) {
    const priceValue =
      offer?.price ??
      offer?.priceSpecification?.price ??
      offer?.lowPrice ??
      offer?.highPrice ??
      null;

    if (priceValue !== null && priceValue !== undefined && priceValue !== "") {
      return Number(String(priceValue).replace(/[^\d.]/g, ""));
    }
  }

  return null;
}

function firstCurrency(offers) {
  const offerList = toArray(offers);

  for (const offer of offerList) {
    if (offer?.priceCurrency) {
      return String(offer.priceCurrency);
    }
  }

  return "USD";
}

function itemIdFromUrl(url) {
  const match = String(url || "").match(/\/itm\/(\d+)/i) || String(url || "").match(/[?&]item=(\d+)/i);
  return match ? match[1] : "";
}

function uniqueByItem(listings) {
  const seen = new Set();
  const unique = [];

  for (const listing of listings) {
    const key = listing.itemId || listing.itemUrl;

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(listing);
  }

  return unique;
}

function listingsFromJsonLd(html, pageNumber) {
  const scripts = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  const listings = [];

  for (const match of scripts) {
    const parsed = safeJsonParse(match[1].trim());
    const objects = Array.isArray(parsed) ? parsed : [parsed];

    for (const object of objects) {
      const itemList = object?.["@type"] === "ItemList" ? object : null;
      const elements = itemList?.itemListElement || object?.itemListElement;

      if (!Array.isArray(elements)) {
        continue;
      }

      for (const element of elements) {
        const item = element?.item || element;
        const itemUrl = item?.url || "";
        const title = stripTags(item?.name || "");

        if (!itemUrl || !title) {
          continue;
        }

        listings.push({
          itemId: itemIdFromUrl(itemUrl),
          title,
          itemUrl,
          imageUrl: Array.isArray(item?.image) ? item.image[0] : item?.image || "",
          price: firstPrice(item?.offers),
          currency: firstCurrency(item?.offers),
          condition: stripTags(item?.itemCondition || ""),
          shipping: "",
          bids: "",
          location: "",
          sourcePage: pageNumber
        });
      }
    }
  }

  return listings;
}

function captureValue(block, patterns) {
  for (const pattern of patterns) {
    const match = block.match(pattern);

    if (match?.[1]) {
      return stripTags(match[1]);
    }
  }

  return "";
}

function captureAttr(block, patterns) {
  for (const pattern of patterns) {
    const match = block.match(pattern);

    if (match?.[1]) {
      return decodeHtml(match[1]).trim();
    }
  }

  return "";
}

function priceValue(value) {
  const match = String(value || "").replace(/,/g, "").match(/(\d+(?:\.\d{1,2})?)/);
  return match ? Number(match[1]) : null;
}

function listingsFromHtml(html, pageNumber) {
  const blocks = [...html.matchAll(/<li[^>]*class="[^"]*s-item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi)];

  return blocks
    .map((match) => {
      const block = match[1];
      const itemUrl = captureAttr(block, [
        /<a[^>]*class="[^"]*s-item__link[^"]*"[^>]*href="([^"]+)"/i,
        /<a[^>]*href="([^"]*\/itm\/[^"]+)"/i
      ]);
      const title = captureValue(block, [
        /<div[^>]*class="[^"]*s-item__title[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        /<span[^>]*role="heading"[^>]*>([\s\S]*?)<\/span>/i
      ]);

      if (!itemUrl || !title || /shop on ebay/i.test(title)) {
        return null;
      }

      const imageUrl = captureAttr(block, [
        /<img[^>]*src="([^"]+)"/i,
        /<img[^>]*data-src="([^"]+)"/i
      ]);
      const priceText = captureValue(block, [/<span[^>]*class="[^"]*s-item__price[^"]*"[^>]*>([\s\S]*?)<\/span>/i]);
      const shipping = captureValue(block, [
        /<span[^>]*class="[^"]*s-item__shipping[^"]*"[^>]*>([\s\S]*?)<\/span>/i
      ]);
      const condition = captureValue(block, [
        /<span[^>]*class="[^"]*SECONDARY_INFO[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
        /<div[^>]*class="[^"]*SECONDARY_INFO[^"]*"[^>]*>([\s\S]*?)<\/div>/i
      ]);
      const bids = captureValue(block, [
        /<span[^>]*class="[^"]*s-item__bids[^"]*"[^>]*>([\s\S]*?)<\/span>/i
      ]);
      const location = captureValue(block, [
        /<span[^>]*class="[^"]*s-item__location[^"]*"[^>]*>([\s\S]*?)<\/span>/i
      ]);

      return {
        itemId: itemIdFromUrl(itemUrl),
        title,
        itemUrl,
        imageUrl,
        price: priceValue(priceText),
        currency: /\bUS\b|\$/i.test(priceText) ? "USD" : "",
        condition,
        shipping,
        bids,
        location,
        sourcePage: pageNumber
      };
    })
    .filter(Boolean);
}

function discoverPageCount(html) {
  const pageMatches = [...html.matchAll(/[?&]_pgn=(\d+)/gi)].map((match) => Number(match[1]));
  const numericPages = pageMatches.filter((value) => Number.isFinite(value));
  return numericPages.length ? Math.max(...numericPages) : 1;
}

async function scrapeStore({ storeUrl, maxPages = 3 }) {
  const normalizedStoreUrl = normalizeStoreUrl(storeUrl);
  const pageLimit = Math.max(1, Math.min(20, Number(maxPages) || 3));
  const allListings = [];
  let pagesScraped = 0;
  let discoveredPageCount = 1;

  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    const pageUrl = buildPagedUrl(normalizedStoreUrl, pageNumber);
    const html = await fetchHtml(pageUrl);
    const fromJsonLd = listingsFromJsonLd(html, pageNumber);
    const fromHtml = listingsFromHtml(html, pageNumber);
    const pageListings = uniqueByItem([...fromJsonLd, ...fromHtml]);

    discoveredPageCount = Math.max(discoveredPageCount, discoverPageCount(html));
    pagesScraped += 1;

    if (!pageListings.length) {
      break;
    }

    allListings.push(...pageListings);

    if (pageNumber >= discoveredPageCount) {
      break;
    }
  }

  const listings = uniqueByItem(allListings).map((listing) => ({
    itemId: listing.itemId || "",
    title: listing.title || "Untitled listing",
    itemUrl: listing.itemUrl,
    imageUrl: listing.imageUrl,
    price: listing.price,
    currency: listing.currency || "USD",
    condition: listing.condition,
    shipping: listing.shipping,
    bids: listing.bids,
    location: listing.location,
    sourcePage: listing.sourcePage
  }));

  if (!listings.length) {
    const error = new Error(
      "No listings were detected. The store layout may have changed or eBay may be blocking automated requests."
    );
    error.statusCode = 422;
    throw error;
  }

  return {
    originalStoreUrl: storeUrl,
    normalizedStoreUrl,
    maxPagesRequested: pageLimit,
    discoveredPageCount,
    pagesScraped,
    listings
  };
}

module.exports = {
  scrapeStore
};