"""Use pinned PanPhon data to compare explicitly transcribed IPA segments."""
import csv
import hashlib
import html
import json
from pathlib import Path
import sys
import unicodedata

PIN = 'a49c242d3307864312a2701055faefa4e548501c'
REPO = 'dmort27/panphon'
DATA_BLOB = '6911103bb53223910949610a81f697849e0c7c64'


def table(source):
    raw = (Path(source) / 'panphon/data/ipa_all.csv').read_bytes()
    digest = hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
    if digest != DATA_BLOB:
        raise ValueError('PanPhon data does not match inspected Git blob')
    rows = list(csv.DictReader(raw.decode().splitlines()))
    features = list(rows[0])[1:]
    return features, {unicodedata.normalize('NFD', r['ipa']): r for r in rows}


def compare(case, features, rows):
    target, observed = case['target'], case['observed']
    if not isinstance(target, list) or not target or not isinstance(observed, list) or len(target) != len(observed):
        raise ValueError('Provide equal nonempty arrays of aligned IPA segments; audio/alignment is not inferred')
    segments = []
    for a, b in zip(target, observed):
        if not isinstance(a, str) or not isinstance(b, str) or not a or not b:
            raise ValueError('IPA segments must be nonempty strings')
        x, y = rows.get(unicodedata.normalize('NFD', a)), rows.get(unicodedata.normalize('NFD', b))
        if x is None or y is None:
            raise ValueError('Unsupported IPA segment; no silent dropping or Hangul conversion')
        diffs = [{'feature': f, 'target': x[f], 'observed': y[f]} for f in features if x[f] != y[f]]
        segments.append({'target': a, 'observed': b, 'different_features': diffs,
                         'feature_mismatch_fraction': len(diffs) / len(features)})
    return {'name': case['name'], 'segments': segments}


def run(source, input_file, output):
    features, rows = table(source)
    cases = [compare(c, features, rows) for c in json.loads(Path(input_file).read_text())]
    result = {'source': {'repo': REPO, 'commit': PIN, 'data_blob_sha': DATA_BLOB},
              'feature_count': len(features), 'metric': 'unweighted categorical feature mismatch, not pronunciation accuracy',
              'input_contract': 'caller-provided aligned IPA; no audio analysis or Korean G2P', 'cases': cases}
    out = Path(output); out.mkdir(parents=True, exist_ok=True)
    (out / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    content = []
    for case in cases:
        for seg in case['segments']:
            diffs = ', '.join(f"{d['feature']}: {d['target']} → {d['observed']}" for d in seg['different_features']) or 'identical feature vectors'
            content.append('<tr><td>' + html.escape(case['name']) + '</td><td>' + html.escape(seg['target'] + ' → ' + seg['observed']) + '</td><td>' + html.escape(diffs) + '</td></tr>')
    (out / 'comparison.html').write_text('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>IPA feature comparison</title><style>body{font:16px/1.6 system-ui;max-width:65rem;margin:3rem auto;padding:1rem}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:1rem;text-align:left}</style><h1>Articulatory feature comparison</h1><p>Explicit IPA contrasts relevant to Korean learning. PanPhon data at commit ' + PIN + '. No audio analysis or clinical score.</p><table><thead><tr><th>Contrast</th><th>Target → observation</th><th>Source-derived differences</th></tr></thead><tbody>' + ''.join(content) + '</tbody></table><p>sg = spread glottis; cor = coronal; ant = anterior; back = back. Values are source features, not an animated anatomical model.</p></html>')
    return result


if __name__ == '__main__':
    run(*sys.argv[1:])
