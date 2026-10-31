import json
from pathlib import Path
from extract import extract

root = Path(__file__).parent
actual = json.loads((root / 'products.json').read_text())
expected = [
    {'sku': 'A-01', 'name': 'Coffee & Tea', 'price_cents': 1290, 'currency': 'USD', 'in_stock': True},
    {'sku': 'A-02', 'name': '머그 컵', 'price_cents': 805, 'currency': 'USD', 'in_stock': False},
    {'sku': 'B-01', 'name': 'Desk Lamp', 'price_cents': 2999, 'currency': 'USD', 'in_stock': True},
    {'sku': 'B-02', 'name': 'Notebook', 'price_cents': 350, 'currency': 'USD', 'in_stock': True},
]
assert actual == expected, (actual, expected)
for malformed in ['<html>No products</html>', '<div itemtype="https://schema.org/Product" data-sku="x"><h2 itemprop="name">Missing price</h2></div>']:
    try:
        extract(malformed)
    except ValueError:
        pass
    else:
        raise AssertionError('Invalid input was silently accepted')
print('PASS: 4 exact product records; nested text, entities, Korean, price precision, stock and 2 negative cases')
