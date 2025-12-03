const express = require("express");
const { chromium } = require("playwright");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Playwright scraper is running.");
});

// Main scraping endpoint
app.post("/scrape", async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "Missing 'url' in request body." });
  }

  try {
    const browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: true
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle" });

    // Get raw HTML
    const html = await page.content();

    await browser.close();
    return res.json({ html });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.toString() });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Scraper running on port ${PORT}`));
