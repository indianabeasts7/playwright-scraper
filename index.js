const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

chromium.use(StealthPlugin());

const app = express();
app.use(cors());

const wait = (ms) => new Promise(res => setTimeout(res, ms));

/*
=====================================
USSSA DIRECT API SCRAPER (FASTEST)
=====================================
*/
async function fetchUSSSA() {
    const api = "https://usssa.com/api/event-search/events?sportIDs=16";

    try {
        const response = await fetch(api, {
            headers: {
                "accept": "application/json, text/plain, */*",
                "origin": "https://usssa.com",
                "referer": "https://usssa.com/",
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
            }
        });

        const json = await response.json();

        if (!json?.events?.length) return null;

        return json.events;

    } catch (err) {
        console.log("USSSA direct API error:", err);
        return null;
    }
}

/*
=====================================
PLAYWRIGHT FALLBACK (STEALTH MODE)
=====================================
*/
async function fetchUSSSA_Playwright() {
    let browser;
    try {
        browser = await chromium.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-dev-shm-usage"]
        });

        const page = await browser.newPage();
        const events = [];

        page.on("response", async (response) => {
            const url = response.url();
            if (url.includes("/api/event-search/events")) {
                try {
                    const data = await response.json();
                    if (data?.events?.length) {
                        events.push(...data.events);
                    }
                } catch {}
            }
        });

        await page.goto("https://usssa.com/fastpitch/eventSearch/", {
            waitUntil: "domcontentloaded",
            timeout: 90000
        });

        await wait(5000);

        await browser.close();
        return events.length ? events : null;

    } catch (err) {
        if (browser) await browser.close();
        return null;
    }
}

/*
=====================================
SCRAPE ROUTE
=====================================
*/
app.get("/scrape", async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: "Missing ?url=" });

    console.log("SCRAPING:", url);

    // USSSA detection
    if (url.includes("usssa.com")) {
        console.log("→ Using USSSA direct API");

        let events = await fetchUSSSA();

        if (!events) {
            console.log("→ API failed → trying Playwright");
            events = await fetchUSSSA_Playwright();
        }

        if (!events) {
            return res.status(500).json({ error: "USSSA API returned no event data" });
        }

        return res.json({ events });
    }

    // Generic fallback
    let browser;

    try {
        browser = await chromium.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-dev-shm-usage"]
        });

        const page = await browser.newPage();
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
        await wait(4000);

        const html = await page.content();
        await browser.close();

        res.send(html);

    } catch (e) {
        if (browser) await browser.close();
        res.status(500).json({ error: e.toString() });
    }
});

app.get("/", (req, res) => {
    res.send("Playwright Scraper is running ✔ (USSSA enabled)");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log("Playwright scraper service started on port", PORT);
});

