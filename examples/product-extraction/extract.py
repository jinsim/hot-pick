"""Extract explicit Product microdata using the selected Scrapling library.

Supports card and table layouts. Does not guess missing prices or scrape a live site.
"""
import json
from decimal import Decimal, InvalidOperation
from pathlib import Path
from scrapling.parser import Selector


def extract(html):
    page = Selector(html)
    rows = []
    for product in page.css('[itemtype$="/Product"]'):
        sku = product.attrib.get('data-sku')
        name = ' '.join(' '.join(product.xpath('.//*[@itemprop="name"]//text()').getall()).split())
        price = product.css('[itemprop="price"]::attr(content)').get()
        if price is None:
            price = ''.join(product.xpath('.//*[@itemprop="price"]//text()').getall()).strip()
        currency = product.css('[itemprop="priceCurrency"]::attr(content)').get()
        stock = product.css('[itemprop="availability"]::attr(href)').get()
        if not sku or not name or not price or currency != 'USD' or stock not in ('https://schema.org/InStock', 'https://schema.org/OutOfStock'):
            raise ValueError('Missing or unsupported product fields')
        try:
            cents = Decimal(price) * 100
            if not cents.is_finite() or cents < 0 or cents != cents.to_integral_value():
                raise ValueError('Invalid price precision')
        except InvalidOperation as exc:
            raise ValueError('Invalid price') from exc
        rows.append({'sku': sku, 'name': name, 'price_cents': int(cents), 'currency': currency, 'in_stock': stock.endswith('/InStock')})
    if not rows:
        raise ValueError('No product records found')
    return rows


if __name__ == '__main__':
    root = Path(__file__).parent
    rows = []
    for name in ['cards.html', 'table.html']:
        rows.extend(extract((root / 'fixtures' / name).read_text()))
    if len({r['sku'] for r in rows}) != len(rows):
        raise ValueError('Duplicate SKU')
    rows.sort(key=lambda r: r['sku'])
    (root / 'products.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
    print(f'Extracted {len(rows)} products with Scrapling')
