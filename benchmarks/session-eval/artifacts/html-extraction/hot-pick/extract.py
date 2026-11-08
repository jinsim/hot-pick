"""Extract validated products from local HTML using Scrapling's offline parser."""

import argparse
from decimal import Decimal, ROUND_HALF_UP, localcontext
import json
from pathlib import Path
import re
import sys

from scrapling.parser import Selector


_AMOUNT = re.compile(
    r"\$?\s*((?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\.[0-9]+)?|\.[0-9]+)"
)
_STOCK = re.compile(r"[0-9]+")


def _field(product: Selector, field: str, sku: str) -> str:
    # CSS class selectors match tokens regardless of class-list order.
    element = product.css(f".{field}").first
    if element is None:
        raise ValueError(f"Product {sku!r}: missing {field}")
    # Preserve text-node boundaries without inventing spaces inside words.
    text = element.get_all_text(separator="", strip=False, valid_values=False)
    value = " ".join(text.split())
    if not value:
        raise ValueError(f"Product {sku!r}: empty {field}")
    return value


def _price(value: str, sku: str) -> str:
    match = _AMOUNT.fullmatch(value)
    if match is None:
        raise ValueError(f"Product {sku!r}: invalid price {value!r}")
    number = match.group(1).replace(",", "")
    # Decimal avoids binary float errors, including for large currency values.
    with localcontext() as context:
        context.prec = max(28, len(number) + 2)
        amount = Decimal(number).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return format(amount, ".2f")


def extract(html: str) -> list[dict]:
    """Return first products by SKU, validating every matching product.

    Match article.product and table tr[data-sku] in document order. Missing
    article SKUs and missing/invalid fields raise ValueError, even on duplicates.
    Prices with extra decimal places round half up to two places.
    """
    page = Selector(html, adaptive=False)
    products = []
    seen = set()
    for product in page.css("article.product, table tr[data-sku]"):
        sku = product.attrib.get("data-sku")
        if sku is None or not sku.strip():
            raise ValueError("Product: missing or empty data-sku")
        name = _field(product, "name", sku)
        price = _price(_field(product, "price", sku), sku)
        stock_text = _field(product, "stock", sku)
        if _STOCK.fullmatch(stock_text) is None:
            raise ValueError(f"Product {sku!r}: invalid stock {stock_text!r}")
        stock = int(stock_text)
        if sku not in seen:
            seen.add(sku)
            products.append({"sku": sku, "name": name, "price": price, "stock": stock})
    return products


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="+", type=Path, help="UTF-8 HTML files")
    args = parser.parse_args(argv)
    products = []
    seen = set()
    try:
        for path in args.files:
            for product in extract(path.read_text(encoding="utf-8")):
                if product["sku"] not in seen:
                    seen.add(product["sku"])
                    products.append(product)
    except (OSError, ValueError) as error:
        print(f"{path}: {error}", file=sys.stderr)
        return 1
    # Emit only after all files validate, so failures never emit partial JSON.
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(products, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
