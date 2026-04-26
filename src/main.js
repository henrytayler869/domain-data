import { Actor, log } from 'apify';
import { setTimeout as delay } from 'node:timers/promises';

await Actor.init();

Actor.on('aborting', async () => {
    await delay(1000);
    await Actor.exit();
});

const input = (await Actor.getInput()) ?? {};

const {
    priceMin   = 0,
    priceMax   = 200,
    tlds       = ['de.com', 'uk.net', 'gb.net', 'us.com', 'eu.com', 'mex.com', 'ru.com', 'co.com', 'us.org'],
    maxResults = 0,
} = input;

log.info('Starting Namecheap Market Scraper (CSV mode)', { priceMin, priceMax, tlds, maxResults });

// Namecheap publishes a public CSV of all Buy Now domains, updated hourly.
// Source: discovered inside https://d3ry1h4w5036x1.cloudfront.net/www/static/js/main.3ce2a6e9.js
const CSV_URL = 'https://d3ry1h4w5036x1.cloudfront.net/reports/Namecheap_Market_Sales_Buy_Now.csv';

log.info('Downloading Buy Now CSV...', { url: CSV_URL });

let csvText;
try {
    const res = await fetch(CSV_URL, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'text/csv,text/plain,*/*',
        },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    csvText = await res.text();
} catch (err) {
    log.error('Failed to download CSV', { error: err.message });
    await Actor.exit({ exitCode: 1 });
}

const lines = csvText.split('\n');
log.info(`CSV downloaded: ${lines.length.toLocaleString()} lines total`);

// Parse header row  →  permalink,domain,price,extensions_taken
const rawHeaders = lines[0].split(',').map((h) => h.trim().toLowerCase());
const domainIdx    = rawHeaders.indexOf('domain');
const priceIdx     = rawHeaders.indexOf('price');
const permalinkIdx = rawHeaders.indexOf('permalink');

if (domainIdx < 0 || priceIdx < 0) {
    log.error('Unexpected CSV format', { headers: rawHeaders });
    await Actor.exit({ exitCode: 1 });
}

// Build fast lookup set for target TLDs
const tldSet = new Set(tlds.map((t) => t.toLowerCase().trim()));

let totalScraped = 0;

for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Namecheap CSV uses simple comma-separated values (no quoting needed)
    const cols      = line.split(',');
    const domain    = (cols[domainIdx]    ?? '').toLowerCase().trim();
    const priceStr  = (cols[priceIdx]     ?? '').trim();
    const permalink = (cols[permalinkIdx] ?? '').trim();

    if (!domain || !priceStr) continue;

    // Extract TLD (everything after the first dot)
    const dotIdx = domain.indexOf('.');
    if (dotIdx < 0) continue;
    const tld = domain.slice(dotIdx + 1);

    // ── TLD filter ─────────────────────────────────────────────────────────
    if (tldSet.size > 0 && !tldSet.has(tld)) continue;

    // ── Price filter ───────────────────────────────────────────────────────
    const price = parseFloat(priceStr);
    if (isNaN(price) || price < priceMin || price > priceMax) continue;

    // ── maxResults guard ───────────────────────────────────────────────────
    if (maxResults > 0 && totalScraped >= maxResults) break;

    await Actor.pushData({
        domainName : domain,
        tld,
        price,
        priceText  : `$${price.toFixed(2)}`,
        buyUrl     : permalink || `https://www.namecheap.com/market/buynow/${domain}/`,
        scrapedAt  : new Date().toISOString(),
    });

    totalScraped++;

    if (totalScraped % 50 === 0) {
        log.info(`Progress: ${totalScraped} domains saved so far...`);
    }
}

log.info(`Done! Saved ${totalScraped} domain(s) matching filters.`, {
    priceMin,
    priceMax,
    tlds: tlds.join(','),
    totalScraped,
});

await Actor.exit();
