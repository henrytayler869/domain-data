import { createPlaywrightRouter } from '@crawlee/playwright';
import { Actor, log } from 'apify';

export const router = createPlaywrightRouter();

// ─── MAIN HANDLER ────────────────────────────────────────────────────────────
router.addHandler('MARKET_LIST', async ({ request, page, pushData, crawler }) => {
    const { priceMin, priceMax, tlds, maxPages, maxResults, currentPage } = request.userData;
    let { totalScraped } = request.userData;

    log.info(`📄 Scraping page ${currentPage}`, { url: request.url });

    // ── 1. Capture ALL network requests (to discover the real API endpoint) ────
    const allRequests = [];
    page.on('request', (req) => {
        const url = req.url();
        const type = req.resourceType();
        // Only care about XHR/fetch and API-looking URLs
        if (['xhr', 'fetch', 'other'].includes(type) || url.includes('/api/') || url.includes('.ashx')) {
            allRequests.push({ url, method: req.method(), type });
        }
    });

    // ── 2. Wait for page + SPA to fully load ─────────────────────────────────
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    // Wait for React SPA to initialize and fire data requests (up to 15s)
    await page.waitForFunction(
        () => {
            const root = document.querySelector('#root, .ncaftmkt main');
            return root && root.children.length > 0;
        },
        { timeout: 15_000 }
    ).catch(() => log.warning('React root never populated (bot detection likely active)'));
    await page.waitForTimeout(3000);

    // ── 2. Probe Namecheap marketplace API endpoints directly ─────────────────
    // The React SPA is blocked by bot-detection in headless mode, so we call
    // the underlying REST API directly using the browser's session (cookies).
    const apiResult = await probeMarketplaceApi(page, priceMin, priceMax, tlds, currentPage);

    if (currentPage === 1) {
        await saveDebugInfo(page, apiResult, allRequests);
    }

    let domains = [];

    if (apiResult?.domains?.length > 0) {
        log.info(`✅ API returned ${apiResult.domains.length} domain(s)`, { endpoint: apiResult.endpoint });
        domains = apiResult.domains;
    } else {
        // Last resort: try DOM if somehow the page rendered
        log.info('API probe found nothing, trying DOM scraper...');
        domains = await scrapeFromDom(page, tlds);
    }

    if (domains.length === 0) {
        log.warning('No domains found. The marketplace may require auth or a residential proxy.');
        log.warning('On Apify platform with residential proxies this should work.');
        return;
    }

    log.info(`Found ${domains.length} domain(s) on page ${currentPage}`);

    // ── 3. Secondary price filter ─────────────────────────────────────────────
    const filtered = domains.filter(({ price }) => {
        const p = parseFloat(price);
        return !isNaN(p) && p >= priceMin && p <= priceMax;
    });
    log.info(`${filtered.length} domain(s) within $${priceMin}–$${priceMax}`);

    // ── 4. Push to dataset ────────────────────────────────────────────────────
    for (const domain of filtered) {
        if (maxResults > 0 && totalScraped >= maxResults) break;
        await pushData({
            ...domain,
            scrapedAt: new Date().toISOString(),
            sourceUrl: page.url(),
            page: currentPage,
        });
        totalScraped++;
    }

    // ── 5. Pagination ─────────────────────────────────────────────────────────
    if ((maxResults > 0 && totalScraped >= maxResults) || (maxPages > 0 && currentPage >= maxPages)) {
        log.info('Limit reached. Done ✅');
        return;
    }

    // Try next page using API pagination metadata or URL bump
    const hasNextPage = apiResult?.totalPages
        ? currentPage < apiResult.totalPages
        : domains.length > 0; // assume next page exists if current was full

    if (hasNextPage) {
        const nextPageUrl = buildNextPageUrl(request.url, currentPage);
        log.info(`➡️  Queuing page ${currentPage + 1}`, { nextPageUrl });
        await crawler.addRequests([{
            url: nextPageUrl,
            label: 'MARKET_LIST',
            userData: { ...request.userData, currentPage: currentPage + 1, totalScraped },
        }]);
    } else {
        log.info('No more pages. Scraping complete ✅');
    }
});

// ─── DIRECT API PROBE ─────────────────────────────────────────────────────────

/**
 * Try multiple known/suspected Namecheap marketplace API endpoints directly
 * using the browser's cookie session (bypasses React bot-detection).
 */
async function probeMarketplaceApi(page, priceMin, priceMax, tlds, currentPage) {
    const PAGE_SIZE = 30;
    const offset    = (currentPage - 1) * PAGE_SIZE;

    // Build probe list — vary param names/formats Namecheap might use
    const endpoints = [
        // Format 1: REST with query string filters
        {
            url: `https://www.namecheap.com/domains/marketplace/api/v1/domains?` +
                 `priceFrom=${priceMin}&priceTo=${priceMax}&extensions=${tlds.join(',')}&` +
                 `sortBy=price&sortOrder=asc&pageSize=${PAGE_SIZE}&offset=${offset}`,
        },
        {
            url: `https://www.namecheap.com/market/api/domains?` +
                 `priceMin=${priceMin}&priceMax=${priceMax}&tlds=${tlds.join(',')}&` +
                 `sort=price_asc&limit=${PAGE_SIZE}&offset=${offset}`,
        },
        // Format 2: Namecheap internal API pattern
        {
            url: `https://www.namecheap.com/api/v1/NCEMarketplace/GetListings?` +
                 `priceFrom=${priceMin}&priceTo=${priceMax}&extensions=${tlds.join(',')}&` +
                 `page=${currentPage}&pageSize=${PAGE_SIZE}`,
        },
        // Format 3: POST body
        {
            url: 'https://www.namecheap.com/domains/marketplace/domains/search',
            method: 'POST',
            body: JSON.stringify({
                priceFrom: priceMin, priceTo: priceMax,
                extensions: tlds, page: currentPage, pageSize: PAGE_SIZE,
                sortBy: 'price', sortOrder: 'asc',
            }),
        },
        // Format 4: GraphQL
        {
            url: 'https://www.namecheap.com/graphql',
            method: 'POST',
            body: JSON.stringify({
                query: `{ marketplaceDomains(priceMin:${priceMin}, priceMax:${priceMax}, tlds:${JSON.stringify(tlds)}, page:${currentPage}) { domains { name price buyUrl } totalCount } }`,
            }),
        },
        // Format 5: Aftermarket-specific
        {
            url: `https://www.namecheap.com/aftermarket/api/domains?` +
                 `minPrice=${priceMin}&maxPrice=${priceMax}&tld=${tlds.join(',')}&` +
                 `page=${currentPage}&size=${PAGE_SIZE}`,
        },
        // Format 6: Direct buynow API
        {
            url: `https://www.namecheap.com/market/buynow/api?` +
                 `priceFrom=${priceMin}&priceTo=${priceMax}&extensions=${tlds.join(',')}&` +
                 `page=${currentPage}`,
        },
    ];

    for (const endpoint of endpoints) {
        log.debug(`Probing: ${endpoint.url.split('?')[0]}`);
        const result = await page.evaluate(async ({ url, method = 'GET', body }) => {
            try {
                const opts = {
                    method,
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        'X-Requested-With': 'XMLHttpRequest',
                    },
                    credentials: 'include',
                };
                if (body) opts.body = body;
                const res = await fetch(url, opts);
                if (!res.ok) return { status: res.status, error: `HTTP ${res.status}` };
                const ct = res.headers.get('content-type') || '';
                if (!ct.includes('json')) return { error: 'Not JSON', ct };
                const json = await res.json();
                return { status: 200, json };
            } catch (e) {
                return { error: e.message };
            }
        }, endpoint);

        if (result.status === 200 && result.json) {
            log.debug(`Got 200 from ${endpoint.url.split('?')[0]}, parsing...`);
            const domains = parseApiResponse(result.json, tlds);
            if (domains.length > 0) {
                const totalPages = extractTotalPages(result.json, PAGE_SIZE);
                return { endpoint: endpoint.url, domains, totalPages, rawResponse: result.json };
            }
            // Got 200 JSON but no parseable domains — save for debug
            log.debug('200 response but no domains parseable', { keys: Object.keys(result.json || {}) });
        }
    }

    return null;
}

// ─── RESPONSE PARSERS ─────────────────────────────────────────────────────────

function parseApiResponse(json, tlds) {
    const tldSet  = new Set(tlds.map((t) => t.toLowerCase()));
    const results = [];
    const seen    = new Set();

    function walk(node, depth = 0) {
        if (!node || typeof node !== 'object' || depth > 12) return;
        if (Array.isArray(node)) {
            let hit = 0;
            for (const item of node) {
                const d = tryExtractDomain(item, tldSet, tlds);
                if (d && !seen.has(d.domainName)) {
                    seen.add(d.domainName);
                    results.push(d);
                    hit++;
                }
            }
            if (hit === 0) for (const item of node) walk(item, depth + 1);
        } else {
            for (const val of Object.values(node)) walk(val, depth + 1);
        }
    }

    walk(json);
    return results;
}

function tryExtractDomain(item, tldSet, tlds) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;

    const domainRaw = (
        item.DomainName ?? item.domainName ?? item.domain ?? item.Domain ??
        item.name       ?? item.Name       ?? item.SLD    ?? item.sld    ?? ''
    ).toString().trim().toLowerCase();

    if (!domainRaw || !domainRaw.includes('.') || domainRaw.length < 4) return null;
    const parts = domainRaw.split('.');
    if (parts.length < 2 || !parts[0]) return null;
    const tld = parts.slice(1).join('.');

    if (tlds.length > 0 && !tldSet.has(tld)) return null;

    const rawPrice =
        item.Price        ?? item.price        ??
        item.BuyNowPrice  ?? item.buyNowPrice   ??
        item.SalePrice    ?? item.salePrice     ??
        item.ListPrice    ?? item.listPrice     ??
        item.Amount       ?? item.amount        ?? null;

    if (rawPrice === null) return null;
    const price = parseFloat(String(rawPrice).replace(/[^0-9.]/g, ''));
    if (isNaN(price) || price <= 0) return null;

    const priceText = item.PriceText ?? item.priceText ?? `$${price.toFixed(2)}`;
    const buyUrl    =
        item.BuyNowURL ?? item.buyNowUrl  ??
        item.BuyUrl    ?? item.buyUrl     ??
        item.Url       ?? item.url        ??
        item.link      ?? '';

    return { domainName: domainRaw, tld, price, priceText, buyUrl };
}

function extractTotalPages(json, pageSize) {
    const total =
        json?.totalCount ?? json?.TotalCount ??
        json?.total      ?? json?.Total      ??
        json?.count      ?? json?.Count      ?? null;
    if (total === null) return null;
    return Math.ceil(total / pageSize);
}

// ─── DOM FALLBACK ─────────────────────────────────────────────────────────────

async function scrapeFromDom(page, tlds) {
    return page.evaluate((tldList) => {
        const tldSet = new Set(tldList.map((t) => t.toLowerCase()));
        const results = [];

        const selectors = [
            '[data-testid="domain-item"]', '.domain-listing', '.market-domain-item',
            '.listing-item', '.domains-list__item', '.domain-row', 'table tbody tr',
            '[class*="domain"][class*="item"]', '[class*="listing-row"]',
        ];

        let rows = [];
        for (const sel of selectors) {
            rows = [...document.querySelectorAll(sel)];
            if (rows.length) break;
        }

        for (const row of rows) {
            let domainName = '';
            for (const sel of ['.domain-name', '.domain-title', '[data-domain]', 'a[href*="market"]', 'td:first-child a', 'td:first-child', 'h3']) {
                const el = row.querySelector(sel);
                const text = el?.getAttribute('data-domain') || el?.textContent?.trim() || '';
                if (text.includes('.')) { domainName = text.toLowerCase(); break; }
            }
            if (!domainName) continue;
            const tld = domainName.split('.').slice(1).join('.');
            if (tldList.length && !tldSet.has(tld)) continue;

            let priceText = '';
            for (const sel of ['.price', '.domain-price', '[class*="price"]', 'td:last-child']) {
                const el = row.querySelector(sel);
                if (el?.textContent?.trim()) { priceText = el.textContent.trim(); break; }
            }
            const m = priceText.match(/[\d,]+\.?\d*/);
            const price = m ? parseFloat(m[0].replace(/,/g, '')) : NaN;
            const buyUrl = row.querySelector('a[href]')?.href ?? '';

            if (!isNaN(price) && price > 0) results.push({ domainName, tld, price, priceText, buyUrl });
        }
        return results;
    }, tlds);
}

// ─── DEBUG ────────────────────────────────────────────────────────────────────

async function saveDebugInfo(page, apiResult, allRequests = []) {
    try {
        await Actor.setValue('debug-html',       await page.content(),                     { contentType: 'text/html' });
        await Actor.setValue('debug-screenshot',  await page.screenshot({ fullPage: true }), { contentType: 'image/png' });
        await Actor.setValue('debug-url',         page.url(),                               { contentType: 'text/plain' });
        await Actor.setValue('debug-api-result',  JSON.stringify(apiResult, null, 2),       { contentType: 'application/json' });
        await Actor.setValue('debug-all-requests', JSON.stringify(allRequests, null, 2),    { contentType: 'application/json' });
        log.info(`Debug artifacts saved — captured ${allRequests.length} XHR/fetch requests`);
        // Print all captured requests to log for easy inspection
        for (const r of allRequests) {
            log.info(`  [${r.method}] ${r.url}`);
        }
    } catch (err) {
        log.warning('Debug save failed', { error: err.message });
    }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function buildNextPageUrl(currentUrl, currentPage) {
    const url = new URL(currentUrl);
    const pgKey = url.searchParams.has('page') ? 'page' : 'pg';
    url.searchParams.set(pgKey, currentPage + 1);
    return url.toString();
}
