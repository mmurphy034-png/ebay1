# eBay Store Scraper DB

A lightweight web tool that scrapes an eBay store, normalizes listing data, and saves snapshots into a local JSON-backed database.

## What it does

- Accepts an eBay store or seller URL
- Crawls paginated listing pages
- Extracts listing title, item ID, price, image, condition, shipping, location, and source page
- Saves the latest snapshot into `data/ebay-store-db.json`
- Lets you search the captured database from the browser UI

## API endpoints

- `POST /api/scrape-store`
- `GET /api/store-data`

## Request example

```json
{
  "storeUrl": "https://www.ebay.com/str/example-store",
  "maxPages": 3
}
```

## Storage note

This project writes to a local JSON file, which works in local development and inside this workspace.

If you deploy this to Vercel, file writes are not durable between invocations. For production use, swap the JSON file layer for a real database such as Postgres, SQLite hosted elsewhere, or Vercel Blob/Postgres.

## Scraping note

The scraper prefers structured page data when available and falls back to HTML extraction. eBay markup can change, so this is best treated as a practical starting point rather than a permanent contract.