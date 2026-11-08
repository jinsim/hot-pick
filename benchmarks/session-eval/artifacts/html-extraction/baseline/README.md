Requires Python 3.9 or newer; no third-party dependencies or installation steps.

Run:

```sh
python3 extract.py cards.html table.html
python3 -m unittest -v test_extract.py
```

Import `extract` from `extract.py` to process an HTML string. Products appear in
document/file order, keeping the first occurrence of each SKU. Every matching
product is validated, including duplicates. Prices accept an optional dollar
prefix, correctly grouped thousands separators and decimal amounts; extra
decimal places round half up to cents. Stock must contain only decimal digits.
Missing/empty fields and invalid values raise `ValueError`. The CLI reads UTF-8,
prints one JSON array only after all files succeed, and reports errors to stderr
with a nonzero exit status.
