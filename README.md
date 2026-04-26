# Namecheap Market Domain Scraper

## What does Namecheap Market Domain Scraper do?

This Actor **automatically scrapes domain listings** from the [Namecheap Marketplace](https://www.namecheap.com/market/buynow/) and filters them by **price range** and **TLD extensions** (e.g. `us.com`, `eu.com`, `de.com`). It returns a clean, structured dataset of available domains including name, TLD, price, and direct buy link — ready to export as JSON, CSV, or Excel.

Built on the Apify platform, you get full cloud scheduling, proxy rotation, monitoring, and API access out of the box.

---

## Why use this Actor?

- **Domain investors** – quickly scan marketplace inventory under your budget
- **Marketers** – find geo-targeted domain extensions (`.us.com`, `.eu.com`, `.de.com`)
- **SEO teams** – discover aged or premium domains at specific price points
- **Automation** – schedule daily runs to track new domain listings automatically

---

## How to use Namecheap Market Domain Scraper

1. Click **Try for free** on the Apify platform
2. Set your **price range** (e.g. Min: `0`, Max: `200`)
3. Choose the **TLDs** you want to scan (defaults pre-filled with 9 popular extensions)
4. Optionally set **Max Pages** or **Max Results** to limit the run
5. Click **Start** and wait for results
6. Download your dataset as **JSON, CSV, or Excel**

---

## Input

Configure via the Input tab in Apify Console or pass JSON directly via API.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `priceMin` | Integer | `0` | Minimum price in USD |
| `priceMax` | Integer | `200` | Maximum price in USD |
| `tlds` | Array of strings | See below | TLD extensions to filter |
| `maxPages` | Integer | `0` (unlimited) | Stop after N pages |
| `maxResults` | Integer | `0` (unlimited) | Stop after N results |

**Default TLDs:**
```
de.com, uk.net, gb.net, us.com, eu.com, mex.com, ru.com, co.com, us.org
```

**Example input (JSON):**
```json
{
    "priceMin": 0,
    "priceMax": 200,
    "tlds": ["us.com", "eu.com", "de.com", "uk.net"],
    "maxPages": 5,
    "maxResults": 100
}
```

---

## Output

Results are pushed to the default Apify dataset. Each item represents one domain listing.

**Example output (2 items):**
```json
[
  {
    "domainName": "globalstore.us.com",
    "tld": "us.com",
    "price": 49.99,
    "priceText": "$49.99",
    "buyUrl": "https://www.namecheap.com/market/buynow/?domain=globalstore.us.com",
    "scrapedAt": "2026-04-11T08:30:00.000Z",
    "sourceUrl": "https://www.namecheap.com/market/buynow/?priceFrom=0&priceTo=200&...",
    "page": 1
  },
  {
    "domainName": "techpro.eu.com",
    "tld": "eu.com",
    "price": 125.00,
    "priceText": "$125.00",
    "buyUrl": "https://www.namecheap.com/market/buynow/?domain=techpro.eu.com",
    "scrapedAt": "2026-04-11T08:30:01.000Z",
    "sourceUrl": "https://www.namecheap.com/market/buynow/?priceFrom=0&priceTo=200&...",
    "page": 1
  }
]
```

You can download the dataset in various formats such as **JSON, HTML, CSV, or Excel** from the Storage tab.

---

## Data Fields

| Field | Format | Description |
|-------|--------|-------------|
| `domainName` | text | Full domain name (e.g. `shop.us.com`) |
| `tld` | text | TLD extension (e.g. `us.com`) |
| `price` | number | Price in USD |
| `priceText` | text | Formatted price string (e.g. `$49.99`) |
| `buyUrl` | link | Direct link to the Namecheap buy page |
| `scrapedAt` | date | ISO timestamp of when item was scraped |
| `page` | number | Which pagination page this came from |

---

## Pricing / Cost Estimation

This Actor uses a **Playwright browser** (required for JavaScript-heavy pages). Estimated cost on Apify:

- ~50–200 domains per page
- ~$0.10–$0.30 per full scrape run (depending on pages)
- Free tier includes enough compute for ~5–10 test runs

---

## Tips & Advanced Options

- **Limit run size** – Set `maxPages: 3` or `maxResults: 50` for quick checks
- **Schedule daily** – Use Apify Scheduler to monitor new listings automatically
- **Export to Google Sheets** – Use Apify's Google Sheets integration in the Integrations tab
- **Narrow TLD list** – The fewer TLDs, the faster and cheaper the run
- **Price filter** – The `priceMax: 200` filter is applied both via URL params and a secondary JS-side check for accuracy

---

## FAQ & Disclaimer

**Is it legal to scrape Namecheap Marketplace?**
This Actor scrapes publicly visible domain listing data. Always review [Namecheap's Terms of Service](https://www.namecheap.com/legal/general/universal-tos/). This tool is intended for personal research and automation only.

**What if no results appear?**
Namecheap may update their page structure. Open an issue in the Issues tab and we'll update the selectors.

**Can I get custom TLD combinations?**
Yes – just edit the `tlds` array in the input to any TLD available on Namecheap Marketplace.

**Need a custom solution?**
Contact us via the Apify platform for custom scraping projects.

---

*Built with [Crawlee](https://crawlee.dev) + [Playwright](https://playwright.dev) on [Apify](https://apify.com)*
