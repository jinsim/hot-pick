"""Use Scrapling on a real public scraping-practice page, with no browser extras."""
import csv
import json
import sys
from decimal import Decimal
from pathlib import Path
from urllib.parse import urljoin
from scrapling.parser import Selector

ROOT = Path(__file__).parent
URL = 'https://books.toscrape.com/'

if '--verify' in sys.argv:
    data = json.loads((ROOT / 'books.json').read_text())
    rows = data['books']
    assert data['source'] == URL
    assert len(rows) == 20, 'Expected the practice site first page to contain 20 books'
    assert len({r['url'] for r in rows}) == 20
    assert all(r['title'] and r['price_pence'] > 0 and r['currency'] == 'GBP' and r['url'].startswith(URL + 'catalogue/') and r['stock_text'] for r in rows)
    with (ROOT / 'books.csv').open() as f:
        assert len(list(csv.DictReader(f))) == 20
    print('PASS: 20 distinct live-page books, complete fields, positive exact prices, JSON and CSV outputs')
else:
    html = (ROOT / 'books.html').read_text()
    page = Selector(html)
    rows = []
    for book in page.css('article.product_pod'):
        title = book.css('h3 a::attr(title)').get()
        href = book.css('h3 a::attr(href)').get()
        price = book.css('.price_color::text').get()
        stock = ' '.join(' '.join(book.xpath('.//*[contains(@class,"availability")]//text()').getall()).split())
        if not title or not href or not price or not price.startswith('£'):
            raise ValueError('Unexpected book markup; do not fabricate missing values')
        rows.append({'title': title, 'url': urljoin(URL, href), 'price_pence': int(Decimal(price[1:]) * 100), 'currency': 'GBP', 'stock_text': stock})
    (ROOT / 'books.json').write_text(json.dumps({'source': URL, 'books': rows}, ensure_ascii=False, indent=2) + '\n')
    with (ROOT / 'books.csv').open('w') as out:
        writer = csv.DictWriter(out, fieldnames=['title', 'url', 'price_pence', 'currency', 'stock_text'])
        writer.writeheader(); writer.writerows(rows)
    print(f'Extracted {len(rows)} books from {URL} using Scrapling')
