"""Extract product cards and table rows using only the Python standard library."""

import argparse
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP, localcontext
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys


@dataclass
class _Node:
    tag: str
    attrs: dict
    children: list = field(default_factory=list)

    def text(self):
        return "".join(c.text() if isinstance(c, _Node) else c for c in self.children)


class _Parser(HTMLParser):
    _VOID = set("area base br col embed hr img input link meta param source track wbr".split())

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = _Node("", {})
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        # HTML permits omitted closing tags for table rows and cells.
        if tag == "tr":
            self._close_optional({"tr"}, {"table"})
        elif tag in {"td", "th"}:
            self._close_optional({"td", "th"}, {"tr", "table"})
        node = _Node(tag, dict(attrs))
        self.stack[-1].children.append(node)
        if tag not in self._VOID:
            self.stack.append(node)

    def _close_optional(self, tags, boundaries):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag in boundaries:
                break
            if self.stack[i].tag in tags:
                del self.stack[i:]
                break

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                break

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self._VOID:
            self.handle_endtag(tag)

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def _walk(node, in_table=False):
    for child in node.children:
        if isinstance(child, _Node):
            yield child, in_table
            yield from _walk(child, in_table or child.tag == "table")


def _field(node, name):
    for descendant, _ in _walk(node):
        if name in (descendant.attrs.get("class") or "").split():
            value = " ".join(descendant.text().split())
            if value:
                return value
            break
    raise ValueError(f"Missing or empty {name}")


_AMOUNT = re.compile(r"\$?\s*((?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\.[0-9]+)?)")


def _product(node):
    sku = (node.attrs.get("data-sku") or "").strip()
    if not sku:
        raise ValueError("Missing or empty data-sku")
    try:
        name = _field(node, "name")
        price_text = _field(node, "price")
        stock_text = _field(node, "stock")
        match = _AMOUNT.fullmatch(price_text)
        if match is None:
            raise ValueError(f"Invalid price: {price_text!r}")
        amount = Decimal(match.group(1).replace(",", ""))
        with localcontext() as context:
            context.prec = max(28, len(amount.as_tuple().digits) + 3)
            price = format(amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP), ".2f")
        if re.fullmatch(r"[0-9]+", stock_text) is None:
            raise ValueError(f"Invalid stock: {stock_text!r}")
        return {"sku": sku, "name": name, "price": price, "stock": int(stock_text)}
    except (ValueError, InvalidOperation) as exc:
        raise ValueError(f"Product {sku!r}: {exc}") from exc


def extract(html: str) -> list[dict]:
    """Return products in document order, retaining the first value for each SKU.

    All matching products are validated, including duplicate occurrences.
    Prices are rounded to cents using decimal ROUND_HALF_UP.
    """
    parser = _Parser()
    parser.feed(html)
    parser.close()
    products = {}
    for node, in_table in _walk(parser.root):
        is_card = node.tag == "article" and "product" in (node.attrs.get("class") or "").split()
        is_row = node.tag == "tr" and in_table and "data-sku" in node.attrs
        if is_card or is_row:
            product = _product(node)
            products.setdefault(product["sku"], product)
    return list(products.values())


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="+", type=Path)
    args = parser.parse_args(argv)
    products = {}
    try:
        for path in args.files:
            for product in extract(path.read_text(encoding="utf-8")):
                products.setdefault(product["sku"], product)
    except (OSError, UnicodeError, ValueError) as exc:
        print(f"extract: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(list(products.values()), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
