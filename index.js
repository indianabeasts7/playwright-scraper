const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");
const cheerio = require("cheerio");

const app = express();
app.use(cors());

// delay helper
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

app.get("/scrape", async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: "Missing ?url=" });

    console.log("\n=========================================");
    console.log("SCRAPE REQUEST:", url);
    console.log("=========================================\n");

    let browser;

    try {
        browser = await chromium.launch({
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--disable-web-security",
                "--no-zygote",
                "--single-process"
            ]
        });

        const page = await browser.newPage();

        // =====================================================================
        // SPECIAL HANDLING FOR USSSA FASTPITCH (API INTERCEPTION MODE)
        // =====================================================================
        if (url.includes("usssa.com/fastpitch/eventSearch")) {
            console.log("🚀 USSSA mode enabled — waiting for API events...");

            let apiData = null;

            page.on("response", async (response) => {
                const apiUrl = response.url();

                // This is the real JSON API USSSA uses
                if (apiUrl.includes("/api/event-search/events")) {
                    console.log("📡 Intercepted:", apiUrl);
                    try {
                        apiData = await response.json();
                    } catch (err) {
                        console.log("Parse error:", err);
                    }
                }
            });

            await page.goto(url, {
                waitUntil: "domcontentloaded",
                timeout: 60000
            });

            await wait(5000);

            await browser.close();

            if (!apiData) {
                return res.status(500).json({
                    error: "USSSA API returned no event data"
                });
            }

            return res.json(apiData);
        }

        // =====================================================================
        // DEFAULT SCRAPER (HTML MODE)
        // =====================================================================

        console.log("📄 Default HTML scrape mode");

        await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });

        await wait(4000); // allow JS rendering

        const html = await page.content();

        await browser.close();
        return res.send(html);

    } catch (err) {
        console.log("❌ SCRAPE FAILURE:", err);
        if (browser) await browser.close();
        return res.status(500).json({ error: err.toString() });
    }
});

// Health check
app.get("/", (req, res) => {
    res.send("Playwright Scraper is running ✔");
});

// Server start
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log("Playwright scraper service listening on port", PORT);
});

