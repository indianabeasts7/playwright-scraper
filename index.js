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

        console.log("Trying:", url);

        await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });

        await page.waitForTimeout(4000);

        const html = await page.content();
        await browser.close();

        return res.send(html);

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
