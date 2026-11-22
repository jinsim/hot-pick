import json
from pathlib import Path
import sys
from compare import compare, table

source, output = sys.argv[1:]
f, rows = table(source)
r = json.loads((Path(output) / 'result.json').read_text())
affricate, dental, a, place, same = r['cases']
assert {'delrel','cor','back'} <= {d['feature'] for d in affricate['segments'][0]['different_features']}
assert all(s['feature_mismatch_fraction'] == 0 for s in affricate['segments'][1:])
assert {d['feature'] for d in dental['segments'][0]['different_features']} == {'strid','distr'}
assert len(f) == r['feature_count'] == 24
assert a['segments'][0]['different_features'] == [{'feature':'sg','target':'+','observed':'-'}]
assert a['segments'][1]['feature_mismatch_fraction'] == 0
assert {'cor','ant','back'} <= {d['feature'] for d in place['segments'][0]['different_features']}
assert all(s['feature_mismatch_fraction'] == 0 for s in same['segments'])
for target, observed in [(['한'],['한']),(['☃'],['p']),([],[]),(['p'],['p','a'])]:
    try:
        compare({'name':'invalid','target':target,'observed':observed}, f, rows)
    except ValueError:
        pass
    else:
        raise AssertionError('Invalid/unsupported input was accepted')
page = (Path(output) / 'comparison.html').read_text()
assert 't͡ɕ → k' in page and 's → θ' in page
assert 'sg: + → -' in page and 'No audio analysis' in page
print('Verified affricate/velar, sibilant/dental, aspiration, place, identical vectors, HTML output and four invalid-input cases against pinned PanPhon data')
