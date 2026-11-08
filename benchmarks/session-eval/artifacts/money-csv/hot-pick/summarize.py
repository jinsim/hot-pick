"""Validate CSV sales and aggregate exact revenue, without third-party packages."""

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


def _price_in_cents(value: str) -> int:
    value = value.strip()
    try:
        price = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError("unit_price must be a finite nonnegative decimal") from exc
    if not price.is_finite() or price < 0 or not _PRICE.fullmatch(value):
        raise ValueError("unit_price must be a finite nonnegative decimal")
    parts = price.as_tuple()
    if parts.exponent < -2:
        raise ValueError("unit_price must have at most two decimal places")
    # Decimal arithmetic uses a bounded context. Extract the exact coefficient
    # instead and accumulate integer cents, so even large totals never round.
    coefficient = 0
    for digit in parts.digits:
        coefficient = coefficient * 10 + digit
    return coefficient * 10 ** (parts.exponent + 2) if coefficient else 0


def summarize(text: str) -> list[dict]:
    """Return SKU-sorted totals; raise ValueError for invalid headers or rows.

    Extra named columns are allowed, but all records must match the header.
    Blank records are invalid. SKU spelling and surrounding spaces are preserved.
    """
    reader = csv.reader(io.StringIO(text.removeprefix("\ufeff"), newline=""), strict=True)
    totals = {}
    try:
        header = next(reader, None)
        if header is None or any(name not in header for name in _REQUIRED):
            raise ValueError("CSV requires columns: sku, quantity, unit_price")
        if len(set(header)) != len(header):
            raise ValueError("CSV contains duplicate columns")
        sku_index, quantity_index, price_index = (header.index(name) for name in _REQUIRED)
        for row in reader:
            try:
                if len(row) != len(header):
                    raise ValueError("row must have the same number of fields as the header")
                sku = row[sku_index]
                if not sku.strip():
                    raise ValueError("sku must not be blank")
                quantity_text = row[quantity_index].strip()
                if not _INTEGER.fullmatch(quantity_text):
                    raise ValueError("quantity must be a nonnegative integer")
                quantity = int(quantity_text)
                if quantity < 0:
                    raise ValueError("quantity must be a nonnegative integer")
                cents = _price_in_cents(row[price_index])
            except ValueError as exc:
                raise ValueError(f"line {reader.line_num}: {exc}") from exc
            old_quantity, old_cents = totals.get(sku, (0, 0))
            totals[sku] = (old_quantity + quantity, old_cents + quantity * cents)
    except csv.Error as exc:
        raise ValueError(f"line {reader.line_num}: invalid CSV: {exc}") from exc
    return [
        {"sku": sku, "quantity": quantity, "revenue": f"{cents // 100}.{cents % 100:02d}"}
        for sku, (quantity, cents) in sorted(totals.items())
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="UTF-8 CSV file with sku,quantity,unit_price columns")
    args = parser.parse_args()
    try:
        with open(args.input, encoding="utf-8-sig", newline="") as source:
            result = summarize(source.read())
    except (OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
