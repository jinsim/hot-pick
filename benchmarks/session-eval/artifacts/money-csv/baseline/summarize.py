"""Validate sales CSV and summarize quantities and exact revenue by SKU."""

import csv
import io
import json
import re
import sys
from decimal import Decimal, InvalidOperation


_INTEGER = re.compile(r"[+-]?[0-9]+\Z")
_PRICE = re.compile(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?\Z")


def summarize(text: str) -> list[dict]:
    """Return sorted SKU totals, raising ValueError for invalid CSV or values.

    Revenue is accumulated as integer cents so decimal context precision cannot
    round either multiplication or addition. Extra named columns are allowed.
    """
    totals = {}
    try:
        reader = csv.reader(io.StringIO(text.removeprefix("\ufeff"), newline=""), strict=True)
        header = next(reader, None)
        required = ("sku", "quantity", "unit_price")
        if header is None or any(header.count(name) != 1 for name in required):
            raise ValueError("CSV must contain sku, quantity, unit_price columns exactly once")
        indices = [header.index(name) for name in required]

        for row in reader:
            line = reader.line_num
            if len(row) != len(header):
                raise ValueError(f"Line {line}: incorrect number of columns")
            sku, quantity_text, price_text = (row[index] for index in indices)
            if not sku.strip():
                raise ValueError(f"Line {line}: SKU must not be blank")
            quantity_text = quantity_text.strip()
            if not _INTEGER.fullmatch(quantity_text):
                raise ValueError(f"Line {line}: quantity must be a nonnegative integer")
            quantity = int(quantity_text)
            if quantity < 0:
                raise ValueError(f"Line {line}: quantity must be nonnegative")

            price_text = price_text.strip()
            if not _PRICE.fullmatch(price_text):
                raise ValueError(f"Line {line}: price must be a finite nonnegative decimal")
            try:
                price = Decimal(price_text)
            except InvalidOperation as exc:
                raise ValueError(f"Line {line}: invalid price") from exc
            if not price.is_finite() or price < 0:
                raise ValueError(f"Line {line}: price must be finite and nonnegative")
            _, digits, exponent = price.as_tuple()
            if exponent < -2:
                raise ValueError(f"Line {line}: price has more than two decimal places")
            coefficient = 0
            for digit in digits:
                coefficient = coefficient * 10 + digit
            cents = coefficient * 10 ** (exponent + 2)
            old_quantity, old_cents = totals.get(sku, (0, 0))
            totals[sku] = (old_quantity + quantity, old_cents + quantity * cents)
    except csv.Error as exc:
        raise ValueError(f"Invalid CSV: {exc}") from exc

    return [
        {"sku": sku, "quantity": quantity, "revenue": f"{cents // 100}.{cents % 100:02d}"}
        for sku, (quantity, cents) in sorted(totals.items())
    ]


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python summarize.py input.csv", file=sys.stderr)
        return 2
    try:
        with open(sys.argv[1], encoding="utf-8-sig", newline="") as source:
            result = summarize(source.read())
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (OSError, UnicodeError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
