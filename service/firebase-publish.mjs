// Operator-only publisher. No model calls or credentials in published content.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {readPublicSnapshot} from './snapshot.mjs';

const api = 'https://firebasehosting.googleapis.com/v1beta1/';
const identifier = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const digest = body => createHash('sha256').update(body).digest('hex');

export async function publishCatalog({file, project, site = project, fetchImpl = fetch,
  getToken = () => execFileSync('gcloud', ['auth','print-access-token'],
    {encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000}).trim()} = {}) {
  if (!identifier.test(project || '') || !identifier.test(site || '')) throw Error('Valid project and dedicated site IDs required');
  // Validate before obtaining a credential or contacting any external endpoint.
  const body = await readPublicSnapshot(file);
  if (!Object.keys(JSON.parse(body).cards).length) throw Error('Refusing to publish an empty catalog');
  const packed = gzipSync(body), hash = digest(packed);
  const token = await getToken();
  if (!token) throw Error('Google Cloud authentication required');
  const headers = {Authorization:`Bearer ${token}`, 'x-goog-user-project':project};
  async function request(endpoint, method='GET', data) {
    const response = await fetchImpl(api + endpoint, {
      method, headers:{...headers,'Content-Type':'application/json'},
      ...(data === undefined ? {} : {body:JSON.stringify(data)}),
      redirect:'error',signal:AbortSignal.timeout(30000)
    });
    if (!response.ok) throw Error(`Firebase ${method} failed (${response.status})`);
    return response.json();
  }
  // Confirm ownership rather than accidentally replacing another project's site.
  await request(`projects/${project}/sites/${site}`);
  const channel = await request(`sites/${site}/channels/live`);
  if (channel.retainedReleaseCount > 10) {
    await request(`sites/${site}/channels/live?updateMask=retainedReleaseCount`,'PATCH',{retainedReleaseCount:10});
  }
  const previous = channel.release?.version?.name;
  if (previous && new RegExp(`^sites/${site}/versions/[A-Za-z0-9_-]+$`).test(previous)) {
    // Hosting injects /__/firebase/init.* files, even on a catalog-only site.
    const existing = await request(`${previous}/files?pageSize=100`);
    const assets = existing.files?.filter(file => !file.path.startsWith('/__/firebase/'));
    if (!existing.nextPageToken && assets?.length === 1 &&
        assets[0].path === '/catalog.json' && assets[0].hash === hash) {
      return {status:'unchanged',url:`https://${site}.web.app/catalog.json`,sha256:digest(body)};
    }
  }
  const version = await request(`sites/${site}/versions`,'POST',{config:{headers:[{
    glob:'/catalog.json', headers:{'Cache-Control':'public, max-age=300, must-revalidate',
      'Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff'}
  }]}});
  if (!new RegExp(`^sites/${site}/versions/[A-Za-z0-9_-]+$`).test(version.name || '')) throw Error('Unexpected version name');
  const files = await request(`${version.name}:populateFiles`,'POST',{files:{'/catalog.json':hash}});
  const required = files.uploadRequiredHashes || [];
  if (!Array.isArray(required) || required.some(value => value !== hash)) throw Error('Unexpected upload hash');
  if (required.length) {
    const expected = `https://upload-firebasehosting.googleapis.com/upload/${version.name}/files`;
    if (files.uploadUrl !== expected) throw Error('Unexpected upload destination');
    const response = await fetchImpl(`${expected}/${hash}`,{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream'},
      body:packed,redirect:'error',signal:AbortSignal.timeout(60000)});
    if (!response.ok) throw Error(`Firebase upload failed (${response.status})`);
    await response.arrayBuffer();
  }
  const finalized = await request(`${version.name}?update_mask=status`,'PATCH',{status:'FINALIZED'});
  if (finalized.status !== 'FINALIZED') throw Error('Version not finalized; previous release retained');
  const release = await request(`sites/${site}/releases?versionName=${encodeURIComponent(version.name)}`,'POST');
  if (release.version?.name !== version.name) throw Error('Unexpected released version');
  return {status:'published',url:`https://${site}.web.app/catalog.json`,version:version.name,
    bytes:body.length,upload_bytes:required.length ? packed.length : 0,sha256:digest(body)};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [project,file,site] = process.argv.slice(2);
    console.log(JSON.stringify(await publishCatalog({project,file,site})));
  } catch (error) {
    // Child-process failures can include credential command output; keep it private.
    console.error(JSON.stringify({ok:false,error:error.status !== undefined ? 'Google Cloud authentication failed' : error.message}));
    process.exitCode=1;
  }
}
