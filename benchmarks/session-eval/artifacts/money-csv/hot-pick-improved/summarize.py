"""Validate sales CSV and aggregate quantities and exact revenue by SKU."""

import argparse
import csv
from decimal import Decimal, InvalidOperation
import io
import json
import re
import sys


_INTEGER = re.compile(r"[+-]?[0-9]+")
_PRICE = re.compile(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?")
_REQUIRED = ("sku", "quantity", "unit_price")


def _price_cents(value: str, line: int) -> int:
    value = value.strip()
    if not _PRICE.fullmatch(value):
        raise ValueError(f"Line {line}: invalid unit_price")
    try:
        price = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError(f"Line {line}: invalid unit_price") from exc
    if not price.is_finite() or price < 0:
        raise ValueError(f"Line {line}: unit_price must be finite and nonnegative")
    _, digits, exponent = price.as_tuple()
    if exponent < -2:
        raise ValueError(f"Line {line}: unit_price has more than two decimal places")
    # Convert the exact decimal representation to integer cents. Decimal
    # multiplication/addition could round under the caller's decimal context.
    coefficient = 0
    for digit in digits:
        coefficient = coefficient * 10 + digit
    return coefficient * 10 ** (exponent + 2) if coefficient else 0


def summarize(text: str) -> list[dict]:
    """Return SKU-sorted totals; raise ValueError for any invalid CSV row.

    Headers may be reordered and include extra named columns. SKU text is
    preserved exactly, including surrounding whitespace on nonblank names.
    Blank records, duplicate headers and inconsistent row widths are invalid.
    """
    reader = csv.reader(io.StringIO(text.removeprefix("\ufeff"), newline=""), strict=True)
    totals = {}
    try:
        header = next(reader, None)
        if not header or any(name not in header for name in _REQUIRED):
            raise ValueError("Missing required columns: sku, quantity, unit_price")
        if len(set(header)) != len(header) or any(not name.strip() for name in header):
            raise ValueError("Column names must be nonblank and unique")
        sku_index, quantity_index, price_index = (header.index(name) for name in _REQUIRED)
        for row in reader:
            line = reader.line_num
            if len(row) != len(header):
                raise ValueError(f"Line {line}: expected {len(header)} fields, got {len(row)}")
            sku = row[sku_index]
            if not sku.strip():
                raise ValueError(f"Line {line}: sku must not be blank")
            quantity_text = row[quantity_index].strip()
            if not _INTEGER.fullmatch(quantity_text):
                raise ValueError(f"Line {line}: quantity must be a nonnegative integer")
            quantity = int(quantity_text)
            if quantity < 0:
                raise ValueError(f"Line {line}: quantity must be a nonnegative integer")
            cents = _price_cents(row[price_index], line)
            old_quantity, old_cents = totals.get(sku, (0, 0))
            totals[sku] = (old_quantity + quantity, old_cents + quantity * cents)
    except csv.Error as exc:
        raise ValueError(f"Line {reader.line_num}: invalid CSV: {exc}") from exc

    return [
        {"sku": sku, "quantity": quantity, "revenue": f"{cents // 100}.{cents % 100:02d}"}
        for sku, (quantity, cents) in sorted(totals.items())
    ]


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="UTF-8 CSV with sku,quantity,unit_price columns")
    args = parser.parse_args(argv)
    try:
        with open(args.input, encoding="utf-8-sig", newline="") as source:
            result = summarize(source.read())
    except (OSError, UnicodeError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
