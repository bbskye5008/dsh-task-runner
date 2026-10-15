import yaml from 'js-yaml';
// Authenticate the installer's identity tuple. This adds no trust for Host SDK
// bytes: the existing registry SRI, module digest and route audits still run.
export function installedReferenceMatches(name, reference, manifest, {lockText,profileManifest,critical=false}={}) {
  if(manifest?.name!==name||typeof manifest.version!=='string'||typeof reference!=='string')return false;
  const base=reference.split('(',1)[0];
  if(base.startsWith('file:')||base===manifest.version)return true;
  if(critical||!/^https:\/\/codeload\.github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/tar\.gz\/[a-f0-9]{40}$/.test(base))return false;
  try {
    if(typeof lockText!=='string'||Buffer.byteLength(lockText)>4*1024*1024)return false;
    const lock=yaml.load(lockText,{schema:yaml.JSON_SCHEMA});
    const importer=lock?.importers?.['.']?.dependencies?.[name],entry=lock?.packages?.[name+'@'+base];
    const integrity=entry?.resolution?.integrity;
    return String(lock?.lockfileVersion)==='9.0'&&importer?.version===reference&&
      typeof importer.specifier==='string'&&profileManifest?.dependencies?.[name]===importer.specifier&&
      entry?.version===manifest.version&&entry?.resolution?.tarball===base&&entry?.resolution?.gitHosted===true&&
      typeof integrity==='string'&&/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity)&&
      !!lock?.snapshots?.[name+'@'+reference];
  }catch{return false;}
}
