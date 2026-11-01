const fs=require('node:fs');const path=require('node:path');const {zipSync}=require('fflate');
const root=path.resolve(__dirname,'..');const out=path.join(root,'dist');fs.mkdirSync(out,{recursive:true});
for(const folder of ['ai-rtl','ai-rtl-firefox']) {
  const version=JSON.parse(fs.readFileSync(path.join(root,folder,'manifest.json'),'utf8')).version;
  const files={};
  function walk(dir,rel=''){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const name=rel+entry.name;if(entry.isDirectory())walk(path.join(dir,entry.name),name+'/');
    else files[folder+'/'+name]=new Uint8Array(fs.readFileSync(path.join(dir,entry.name)));
  }}
  walk(path.join(root,folder));fs.writeFileSync(path.join(out,folder+'-'+version+'.zip'),zipSync(files));
}
