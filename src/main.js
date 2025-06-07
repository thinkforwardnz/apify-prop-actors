const { Actor } = require('apify');
const { PlaywrightCrawler, Dataset } = require('crawlee');

Actor.main(async () => {
    const input = await Actor.getInput() || {};
    const {
        url: inputUrl,
        region, suburb, keywords, bedroomsMin, bedroomsMax, priceMin, priceMax
    } = input;

    let url;
    if (inputUrl) {
        url = inputUrl;
    } else {
        const baseUrl = `https://www.trademe.co.nz/a/property/residential/sale/${region}/search`;
        let params = [];
        if (keywords && keywords.length) params.push(`search_string=${encodeURIComponent(keywords.join(' '))}`);
        if (bedroomsMin) params.push(`bedrooms_min=${bedroomsMin}`);
        if (bedroomsMax) params.push(`bedrooms_max=${bedroomsMax}`);
        if (priceMin) params.push(`price_min=${priceMin}`);
        if (priceMax) params.push(`price_max=${priceMax}`);
        if (suburb) params.push(`suburb=${encodeURIComponent(suburb)}`);
        url = params.length ? `${baseUrl}?${params.join('&')}` : baseUrl;
    }

    // The PlaywrightCrawler will handle two types of pages:
    // - The search results page (enqueue all listings and next page)
    // - The individual listing page (extract all the details)

    const crawler = new PlaywrightCrawler({
        async requestHandler({ request, page, enqueueLinks, log }) {
            if (request.label === 'DETAIL') {
                // Extract property details from listing page
                const data = {};

                data.url = page.url();

                try {
                    data.title = await page.$eval('[data-test="listing-title"]', el => el.textContent.trim());
                } catch {}
                try {
                    data.price = await page.$eval('[data-test="listing-price"]', el => el.textContent.trim());
                } catch {}
                try {
                    data.address = await page.$eval('[data-test="listing-address"]', el => el.textContent.trim());
                } catch {}
                try {
                    data.description = await page.$eval('[data-test="listing-description"]', el => el.textContent.trim());
                } catch {}
                try {
                    // Features, such as bedrooms, bathrooms, land area
                    const features = await page.$$eval('[data-test="property-feature"]', els => els.map(e => e.textContent.trim()));
                    data.features = features;
                } catch {}
                try {
                    // Main photo (and others if needed)
                    const photos = await page.$$eval('[data-test="gallery-thumbnail"] img', imgs => imgs.map(img => img.src));
                    data.photos = photos;
                } catch {}
                try {
                    // Agent info
                    data.agent = await page.$eval('[data-test="contact-details-name"]', el => el.textContent.trim());
                    data.agency = await page.$eval('[data-test="contact-details-agency"]', el => el.textContent.trim());
                } catch {}

                // Save to dataset
                await Dataset.pushData(data);
            } else {
                // We're on the search results page
                // Enqueue all property links for detail scraping
                await enqueueLinks({
                    selector: 'a[data-test="listing-card-link"]',
                    label: 'DETAIL'
                });

                // Enqueue the next page if it exists
                const nextButton = await page.$('a[title="Next page"]');
                if (nextButton) {
                    const nextUrl = await page.evaluate(el => el.href, nextButton);
                    await crawler.addRequests([{ url: nextUrl }]);
                }
            }
        },
        maxRequestsPerCrawl: 50,
        // proxyConfiguration: await Actor.createProxyConfiguration(), // Add if needed
    });

    // Initial request: set label for search results page
    await crawler.run([{
        url,
        label: 'START'
    }]);
});
