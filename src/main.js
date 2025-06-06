const { Actor } = require('apify');
const { PlaywrightCrawler } = require('crawlee');

Actor.main(async () => {
    // Get criteria (can be passed in as INPUT)
    const {
        region, suburb, keywords, bedroomsMin, bedroomsMax, priceMin, priceMax
    } = await Actor.getInput();

    // Build Trade Me search URL
    let url = `https://www.trademe.co.nz/a/property/residential/sale/${region}`;
    let params = [];
    if (bedroomsMin) params.push(`bedrooms_min=${bedroomsMin}`);
    if (bedroomsMax) params.push(`bedrooms_max=${bedroomsMax}`);
    if (priceMin) params.push(`price_min=${priceMin}`);
    if (priceMax) params.push(`price_max=${priceMax}`);
    if (keywords && keywords.length) params.push(`search_string=${encodeURIComponent(keywords.join(' '))}`);
    if (suburb) params.push(`suburb=${encodeURIComponent(suburb)}`);
    if (params.length) url += '?' + params.join('&');

    const startUrls = [url];

    // Flipping keywords to flag "potential"
    const flippingIndicators = [
        'as is', 'renovate', 'add value', 'do up', 'mortgagee', 'deceased estate', 'potential', 'needs work', 'fixer'
    ];

    const results = [];

    const crawler = new PlaywrightCrawler({
        async requestHandler({ page }) {
            // Wait for the listing cards to load
            await page.waitForSelector('[data-test="property-card"]', { timeout: 10000 });

            // Get links for all results on the page
            const listings = await page.$$('[data-test="property-card"]');
            for (const listing of listings) {
                // Extract text details
                const title = await listing.$eval('[data-test="card-title"]', el => el.textContent.trim());
                const link = await listing.$eval('a', el => el.href);
                const desc = await listing.$eval('[data-test="property-description"]', el => el.textContent.trim());
                const price = await listing.$eval('[data-test="listing-price"]', el => el.textContent.trim());
                const photo = await listing.$eval('img', el => el.src);

                // Basic flipping keyword filter
                const text = `${title} ${desc}`.toLowerCase();
                const matchesFlipping = flippingIndicators.some(k => text.includes(k));

                // Extract bedrooms
                let bedrooms = null;
                try {
                    bedrooms = await listing.$eval('[data-test="property-features"]', el => el.textContent.match(/(\d+) bed/)[1]);
                } catch (e) {}

                // Only push if flipping indicators or "potential"
                if (matchesFlipping) {
                    results.push({
                        title,
                        link,
                        desc,
                        price,
                        photo,
                        bedrooms,
                        suburb,
                        region
                    });
                }
            }

            // Paginate if next page exists
            const next = await page.$('a[aria-label="Next page"]');
            if (next) {
                await next.click();
                await page.waitForTimeout(2000);
                await page.waitForSelector('[data-test="property-card"]');
                // This triggers another run of the handler
            }
        },
        maxRequestsPerCrawl: 10, // Don't hammer their site!
        // Optionally: proxy config here
    });

    await crawler.run(startUrls);

    // Output results
    await Actor.pushData(results);
});