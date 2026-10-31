import { constants, promises as fs } from 'node:fs';

export const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024;
const fields = ['situations', 'inputs', 'outputs', 'constraints'];
const excerpts = [...fields, 'headings'];
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key));
const timestamp = value => value === null || (typeof value === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)));
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const repo = value => typeof value === 'string' && /^[\w.-]+\/[\w.-]+$/.test(value) &&
  value.split('/').every(part => part !== '.' && part !== '..');
const skillPath = value => typeof value === 'string' && !/[\\:\x00-\x1f]/.test(value) &&
  value.endsWith('SKILL.md') && value.split('/').at(-1) === 'SKILL.md' &&
  value.split('/').every(part => part && part !== '.' && part !== '..');
const count = value => Number.isSafeInteger(value) && value >= 0;
const nullableCount = value => value === null || count(value);
const publicText = (value, limit) => typeof value === 'string' && value.length <= limit &&
  !/file:\/\/|\/(?:Users|home)\/|[a-z]:\\Users\\/i.test(value);
const items = (value, limit, valid) => Array.isArray(value) && value.length <= limit && value.every(valid);
const trendSource = /^https:\/\/github\.com\/trending(?:\/[\w.%-]+)?\?since=(daily|weekly|monthly)$/;

function validProfile(profile, blob) {
  if (!exact(profile, ['description', 'method', 'semantic_review', ...excerpts]) ||
      profile.method !== 'source_excerpts' || !publicText(profile.description, 12000) ||
      !excerpts.every(key => items(profile[key], 40, row => exact(row, ['line', 'text']) &&
        count(row.line) && row.line > 0 && publicText(row.text, 2000)))) return false;
  const review = profile.semantic_review;
  return review === null || (exact(review, ['blob_sha', 'evidence', ...fields]) &&
    review.blob_sha === blob && review.evidence?.length > 0 &&
    [...fields, 'evidence'].every(key => items(review[key], 40, value => publicText(value, 2000))));
}

function validCard(id, card) {
  if (!exact(card, ['id', 'repo', 'name', 'commit', 'skill_path', 'blob_sha', 'license', 'stars',
    'profile', 'source', 'checked_at']) || !repo(card.repo) || !skillPath(card.skill_path) ||
    !sha(card.commit) || !sha(card.blob_sha) || !publicText(card.name, 256) || !card.name ||
    (card.license !== null && (typeof card.license !== 'string' || !/^[\w.+-]{1,128}$/.test(card.license))) ||
    !nullableCount(card.stars) || !timestamp(card.checked_at) ||
    !validProfile(card.profile, card.blob_sha)) return false;
  const prefix = `https://github.com/${card.repo}/blob/${card.commit}/`;
  return id === card.id && id === `${card.repo}:${card.skill_path}` &&
    (card.source === prefix + card.skill_path ||
      card.source === prefix + card.skill_path.split('/').map(encodeURIComponent).join('/'));
}

function validTrend(source, trend) {
  const since = trendSource.exec(source)?.[1];
  return Boolean(since) && exact(trend, ['checked_at', 'repositories']) && timestamp(trend.checked_at) &&
    items(trend.repositories, 100, row => exact(row, ['repo', 'rank', 'since', 'language_filter',
      'period_stars', 'total_stars']) && repo(row.repo) && count(row.rank) && row.rank > 0 &&
      row.since === since && (row.language_filter === null ||
        (typeof row.language_filter === 'string' && /^[\w+#.-]+$/.test(row.language_filter))) &&
      nullableCount(row.period_stars) && nullableCount(row.total_stars));
}

export function snapshotIdentity(stat) {
  if (!stat.isFile() || stat.size <= 0n || stat.size > BigInt(MAX_SNAPSHOT_BYTES)) {
    throw Error('Expected a nonempty regular snapshot file of at most 32 MiB');
  }
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}

export async function readPublicSnapshot(file, expectedIdentity) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat({ bigint: true });
    const identity = snapshotIdentity(stat);
    if (expectedIdentity && identity !== expectedIdentity) throw Error('Snapshot changed before read');
    const body = Buffer.alloc(Number(stat.size));
    for (let offset = 0; offset < body.length;) {
      const { bytesRead } = await handle.read(body, offset, body.length - offset, offset);
      if (!bytesRead) throw Error('Snapshot changed during read');
      offset += bytesRead;
    }
    if (identity !== snapshotIdentity(await handle.stat({ bigint: true }))) {
      throw Error('Snapshot changed during read');
    }
    const snapshot = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
    if (!exact(snapshot, ['schema', 'updated_at', 'cards', 'trends']) || snapshot.schema !== 1 ||
        !timestamp(snapshot.updated_at) || !record(snapshot.cards) || !record(snapshot.trends)) {
      throw Error('Invalid public snapshot');
    }
    const cards = Object.entries(snapshot.cards);
    if (cards.length > 10000 || !cards.every(([id, card]) => validCard(id, card)) ||
        !Object.entries(snapshot.trends).every(([source, trend]) => validTrend(source, trend))) {
      throw Error('Invalid public snapshot');
    }
    // Never send unparsed input: duplicate JSON keys can hide unvalidated bytes.
    return Buffer.from(JSON.stringify(snapshot));
  } finally {
    await handle.close();
  }
}
