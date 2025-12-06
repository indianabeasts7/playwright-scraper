
const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");

const app = express();
app.use(cors());

const wait = (ms) => new Promise(res => setTimeout(res, ms));

app.get("/scrape", async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: "Missing ?url=" });

    console.log("SCRAPE REQUEST:", url);

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
                "--no-zygote"
            ]
        });

        const page = await browser.newPage();

        let html = null;

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log(`Attempt ${attempt} → ${url}`);

                await page.goto(url, {
                    waitUntil: "domcontentloaded",
                    timeout: 60000
                });

                await wait(4000);

                html = await page.content();

                if (html.includes("Access Denied") || html.includes("Forbidden")) {
                    console.log("Blocked → retry...");
                    await wait(3000);
                    continue;
                }

                break;

            } catch (err) {
                console.log("Attempt error:", err.toString());
                await wait(2000);
            }
        }

        await browser.close();

        if (!html) return res.status(500).json({ error: "Failed after 3 retries" });

        return res.send(html);

    } catch (e) {
        if (browser) await browser.close();
        console.log("FATAL ERROR:", e);
        return res.status(500).json({ error: e.toString() });
    }
});

app.get("/", (req, res) => {
    res.send("Playwright Scraper is running ✔");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Scraper running on port ${PORT}`);
});

