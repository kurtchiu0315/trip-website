---
name: web-crawler
description: |
  Crawl web pages and save content as markdown for research and reference.
  USE THIS SKILL when user wants to:
  - "爬蟲", "crawl", "抓取網頁", "下載網頁"
  - "收集資料", "建立參考文獻", "把網頁轉成markdown"
  - "批次下載多個URL"
  - "抓這個網頁下來", "幫我存這個頁面"

  The skill requires a Python virtual environment with dependencies installed.
  All crawled content saves to `reference/` directory as markdown files.
---

# Web Crawler Skill

Crawl web pages and save content as markdown for research and reference.

## Usage

When user asks to crawl web pages, follow this workflow:

### Step 1: Check Environment

Make sure the virtual environment exists and has dependencies:

```bash
cd <project-root>
source .venv/bin/activate
```

If `.venv` doesn't exist, create it:
```bash
python3 -m venv .venv && source .venv/bin/activate && pip install markdownify requests beautifulsoup4
```

### Step 2: Run Crawler

**Single URL:**
```bash
python3 -c "
from pathlib import Path
import sys
sys.path.insert(0, str(Path('.claude/skills/web-crawler/scripts')))
from crawl import WebCrawler
crawler = WebCrawler(output_dir='reference', delay=2)
crawler.crawl_and_save('https://example.com/page')
"
```

**Multiple URLs:**
Create a temporary script or run the built-in batch:

```python
urls = [
    'https://example.com/page1',
    'https://example.com/page2',
]
crawler = WebCrawler(output_dir='reference', delay=2)
results = crawler.crawl_batch(urls)
```

### Step 3: Verify Results

Check that files were created in `reference/`:
```bash
ls -la reference/
```

## Crawler Configuration

The `WebCrawler` class is in `.claude/skills/web-crawler/scripts/crawl.py`.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `output_dir` | `reference` | Where to save markdown files |
| `delay` | `2` | Seconds between requests (avoid 403) |

### User-Agent Configuration

The crawler uses a realistic browser User-Agent to bypass basic anti-bot protection:

```python
self.session.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
})
```

## Troubleshooting

### 403 Forbidden

If a site returns 403:
1. Try a different site (some sites block all crawlers)
2. Use `WebFetch` tool as alternative
3. Try Wayback Machine: `https://web.archive.org/web/2024/https://example.com`
4. Fall back to `mcp__MiniMax__web_search` to get information via search

### WebFetch as Alternative

When crawler fails or site blocks bots, use WebFetch tool:
```python
WebFetch(prompt="提取所有實用資訊：景點、票價、交通方式", url="https://example.com")
```

### WebSearch Fallback

When both crawler and WebFetch fail, use web search to find alternative sources:
```
mcp__MiniMax__web_search(query="嵐山小火車 票價 2026")
```
Then use the search results to find working URLs or extract information directly from search snippets.

### Common Blocked Domains

| 網站 | 建議替代方案 |
|------|-------------|
| bring-you.info | 使用 WebFetch 或 web_search |
| klook.com | 使用 web_search 找其他來源 |
| 日本の公式サイト | 可能需要 VPN 或使用 Wayback Machine |

## Workflow Summary

1. **Try crawler first** - for bulk download
2. **Fallback to WebFetch** - when 403/404 or single page
3. **Use web_search** - when both fail, find alternative sources
4. **Always verify** - check the saved file content before reporting success

## Script Location

```
.claude/skills/web-crawler/
├── SKILL.md                 # This file
└── scripts/
    └── crawl.py            # WebCrawler implementation
```

## Example Workflow

```
User: 幫我爬這個頁面 https://example.com/article

Claude:
1. Checks .venv exists
2. Runs crawler with the URL
3. Saves to reference/article.md
4. Reports: ✅ Saved 15KB to reference/article.md
```