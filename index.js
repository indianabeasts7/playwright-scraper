const express = require("express");
const cors = require("cors");
const playwright = require("playwright");

const app = express();
app.use(cors());

// ---- SCRAPE ROUTE ----
app.get("/scrape", async (req, res) => {
    const url = req.query.url;
    if (!url) {
        return res.status(400).json({ error: "Missing ?url=" });
    }

    let browser;

    try {
        browser = await playwright.chromium.launch({
            headless: true,
            args: ["--no-sandbox"]
        });

        const page = await browser.newPage();

        let usssaData = null;

        // 🔥 Capture the dynamic API request
        page.on("response", async (response) => {
            const requestUrl = response.url();

            if (requestUrl.includes("searchFastpitch")) {
                try {
                    usssaData = await response.json();
                    console.log("Captured USSSA API!");
                } catch (err) {
                    console.log("Failed to parse fastpitch JSON:", err);
                }
            }
        });

        console.log("Navigating:", url);

        await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });

        await page.waitForTimeout(4000); // allow JS requests to fire

        await browser.close();

        // 🎯 If we captured USSSA backend event data, return it
        if (usssaData) {
            return res.json(usssaData);
        }

        // ❗ If no API captured, return HTML
        return res.send(await page.content());

    } catch (err) {
        if (browser) await browser.close();
        return res.status(500).json({ error: err.toString() });
    }
});

// ---- HOME ROUTE ----
app.get("/", (req, res) => {
    res.send("Playwright Scraper is running");
});

// ---- START SERVER ----
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log("Scraper running on port", PORT);
});

