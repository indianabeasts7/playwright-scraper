const express = require("express");
const cors = require("cors");
const playwright = require("playwright");

const app = express();
app.use(cors());

app.get("/scrape", async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: "Missing ?url=" });

    let browser;
    try {
        browser = await playwright.chromium.launch({
            headless: true,
            args: ["--no-sandbox"]
        });

        const page = await browser.newPage();

        let apiResponse = null;

        // Capture USSSA API responses
        page.on("response", async (response) => {
            const requestUrl = response.url();

            if (requestUrl.includes("api/tournaments/searchFastpitch")) {
                try {
                    apiResponse = await response.json();
                } catch (err) {
                    console.log("JSON parse failed:", err);
                }
            }
        });

        console.log("Navigating:", url);

        await page.goto(url, {
            waitUntil: "networkidle",
            timeout: 60000
        });

        // Wait a bit for JS API requests
        await page.waitForTimeout(4000);

        await browser.close();

        if (apiResponse) {
            return res.json(apiResponse);
        }

        return res.send(await page.content());

    } catch (error) {
        if (browser) await browser.close();
        return res.status(500).json({ error: error.toString() });
    }
});

app.get("/", (req, res) => {
    res.send("Playwright Scraper is running");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log("Scraper running on port", PORT);
});
