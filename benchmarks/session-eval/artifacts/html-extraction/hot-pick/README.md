# Local product extraction

Tested with Python 3.14.7 on macOS. Reproduce in this directory:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --no-cache-dir -r requirements.txt
python -m unittest -v
python -m pip check
python extract.py cards.html table.html
```

The free, BSD-3-Clause Scrapling parser and its dependencies are installed only
in `.venv`; exact installed versions are in `requirements.txt`. No fetcher or
browser extras are required. Extraction performs no network requests.

Import `extract(html: str) -> list[dict]` from `extract.py`. It selects
`article.product` and `table tr[data-sku]` in document order and extracts the
first descendant carrying each field class. Names concatenate descendant text,
decode HTML entities once through the parser, and collapse whitespace. Class
tokens can appear in any order. Unrelated markup and table rows without SKUs
are ignored. Product articles require a nonempty `data-sku`.

Prices accept an optional dollar prefix, correctly grouped comma thousands,
and nonnegative decimals; extra decimal places round half up. The output price
always has two decimal places. Stock must contain only decimal digits and is
returned as an integer. Missing or empty fields and invalid numeric values raise
`ValueError`. Every selected product is validated, including later duplicates.
The first occurrence of each exact SKU wins within a document and across CLI
files in argument order. The CLI reads UTF-8 and emits one UTF-8 JSON array only
after all files validate; errors go to stderr with a nonzero exit status.

## Hot-pick selection

Public task keywords: Python, HTML, parsing, BeautifulSoup, extraction.
`hot-pick-task.json` retains the operation and constraints. Used the supplied
pinned hot-pick CLI with `--cache .hot-pick-cache`,
`--catalog-url https://jinsim-hot-pick.web.app/index.json`, and `--timeout 40000`.
Route trace: `ae92d67c-ef7e-43d0-a215-6b4a533243f6`.

Selected [D4Vinci/Scrapling's parser guidance](https://github.com/D4Vinci/Scrapling/blob/c5121c7c06a8595ed3a0a9b7b7dcd6802b5ebfc5/agent-skill/Scrapling-Skill/SKILL.md)
at commit `c5121c7c06a8595ed3a0a9b7b7dcd6802b5ebfc5`, licensed BSD-3-Clause.
Inspected that entrypoint, its referenced
`references/migrating_from_beautifulsoup.md`, `pyproject.toml`, and
`scrapling/parser.py` at the same pin. Applied its direct `Selector(html)` offline
parsing, scoped CSS selectors, missing-element checks, and descendant-text
extraction. Disabled adaptive storage explicitly. Installed PyPI release 0.5.1,
matching the inspected project version; this is a release dependency, not a
claim that the wheel is a checkout of the pinned commit.

Rejected the skill-creator candidate because this task creates an extractor,
not a skill, and the VS Code CPU-profile candidate because it analyzes profiler
JSON rather than HTML. Their catalog details were inspected; neither was used.
Browser fetching, crawling, and the full Scrapling extras were unnecessary.

## Checks

- `.venv/bin/python -m unittest -v`: 13 tests passed, including subcases for
  missing/invalid fields, malformed thousands separators, negative/nonfinite
  prices, fractional/negative stock, whitespace, entities, nested text, class
  order, large exact prices, duplicate order, and CLI failures without partial
  output. Temporary fixtures stay inside this directory and are removed.
- The provided fixtures produce A (Coffee & tea, 12.50, 3), B (컵, 0.10, 0),
  and C (Desk, 1299.90, 2), in that order, across both files.
- `.venv/bin/python -m pip check`: passed.

`hot-pick-outcome.json` records the decisions, artifacts, and check results;
`catalog-record` attaches them to the local trace. Only the public catalog and
pinned source were fetched for discovery; no live product sites or model APIs
were called.
