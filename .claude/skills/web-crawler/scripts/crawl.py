#!/usr/bin/env python3
"""
Web Crawler for Travel Reference
Crawl web pages and save as markdown files
"""

import os
import requests
from bs4 import BeautifulSoup
from pathlib import Path
from urllib.parse import urlparse, unquote
import time

# Optional: install markdownify if not present
try:
    from markdownify import markdownify as md
except ImportError:
    print("Installing markdownify...")
    os.system("pip install markdownify")
    from markdownify import markdownify as md


class WebCrawler:
    def __init__(self, output_dir="reference", delay=2):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.delay = delay  # seconds between requests
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
            # Note: Let requests handle decompression automatically
            # If Brotli decompression is needed, install brotli package
        })

    def extract_filename(self, url):
        """Generate filename from URL"""
        parsed = urlparse(url)
        path = unquote(parsed.path.strip("/"))
        if not path or path == "/":
            return "index.md"

        # Clean path to valid filename
        filename = path.replace("/", "_").replace("\\", "_")
        if not filename.endswith(".md"):
            filename += ".md"

        # Limit length
        if len(filename) > 100:
            filename = filename[:100]

        return filename

    def extract_content(self, soup):
        """Extract main content from HTML soup"""
        # Remove script and style elements
        for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
            tag.decompose()

        # Try to find main content area
        main = soup.find("main") or soup.find("article") or soup.find("div", class_=lambda x: x and ("content" in x.lower() or "article" in x.lower()))

        if main:
            return main
        return soup.body if soup.body else soup

    def clean_text(self, text):
        """Clean extracted text"""
        lines = text.split("\n")
        cleaned = []
        for line in lines:
            line = line.strip()
            if line and len(line) > 2:
                cleaned.append(line)
        return "\n\n".join(cleaned)

    def crawl_url(self, url):
        """Crawl a single URL and return markdown content"""
        try:
            print(f"Fetching: {url}")
            resp = self.session.get(url, timeout=30)
            resp.raise_for_status()
            resp.encoding = resp.apparent_encoding or "utf-8"

            soup = BeautifulSoup(resp.text, "html.parser")
            content = self.extract_content(soup)
            text = content.get_text(separator="\n", strip=True)
            text = self.clean_text(text)

            # Convert relative links to markdown
            markdown = md(str(content), heading_style="atx")

            return {
                "success": True,
                "markdown": markdown,
                "text": text,
                "status_code": resp.status_code
            }

        except requests.exceptions.RequestException as e:
            return {
                "success": False,
                "error": str(e),
                "status_code": getattr(e.response, "status_code", None)
            }

    def crawl_and_save(self, url):
        """Crawl URL and save to file"""
        result = self.crawl_url(url)

        if result["success"]:
            filename = self.extract_filename(url)
            filepath = self.output_dir / filename

            with open(filepath, "w", encoding="utf-8") as f:
                f.write(f"# Source: {url}\n\n")
                f.write(result["markdown"])

            print(f"  ✅ Saved: {filepath}")
            return filepath
        else:
            print(f"  ❌ Failed: {result.get('error', 'Unknown error')}")
            return None

    def crawl_batch(self, urls):
        """Crawl multiple URLs"""
        results = []
        for url in urls:
            result = self.crawl_and_save(url)
            results.append({"url": url, "result": result})
            if self.delay > 0:
                time.sleep(self.delay)
        return results


def main():
    # URLs to crawl - all from reference sources
    urls = [
        # 天氣與穿著
        "https://matcha-jp.com/tw/4945",
        "https://kaikk.tw/japan-outfits/",
        "https://osaka.letsgojp.com/archives/683738/",
        "https://osaka.letsgojp.com/archives/344905/",

        # 行程規劃
        "https://matcha-jp.com/tw/18058",
        "https://monicalife.com/world-trip/kyoto-osaka/",

        # 交通攻略
        "https://tw.trip.com/guide/transport/%E9%97%9C%E8%A5%BF+JR+Pass.html",
        "https://mimigo.tw/kansai-jrpass/",
        "https://bishdream.com/kansai-transport-passes/",

        # 賞楓情報
        "https://osaka.letsgojp.com/archives/55899/",
        "https://hk.trip.com/moments/detail/kyoto-430-139065264/",

        # 美食推薦
        "https://auntie.tw/2017-07-02-1012/",

        # 購物指南
        "https://marukoblog.tw/2014-12-osaka-omiyage.html",
        "https://marktrip.tw/shinsaibashi/",
        "https://livejapan.com/zh-tw/in-kansai/in-pref-kyoto/in-kyoto-station_to-ji-temple/article-a2000788/",
    ]

    print("=" * 60)
    print("Web Crawler - Travel Reference")
    print("=" * 60)

    crawler = WebCrawler(output_dir="reference", delay=2)
    results = crawler.crawl_batch(urls)

    print("\n" + "=" * 60)
    print("Summary")
    print("=" * 60)

    success = sum(1 for r in results if r["result"])
    failed = len(results) - success
    print(f"Total: {len(results)} | Success: {success} | Failed: {failed}")


if __name__ == "__main__":
    main()