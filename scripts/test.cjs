const {spawnSync}=require('node:child_process');
const fs=require('node:fs');const path=require('node:path');
for(const name of fs.readdirSync(path.join(__dirname,'../tests')).filter(n=>n.endsWith('.cjs')).sort()) {
  const result=spawnSync(process.execPath,[path.join(__dirname,'../tests',name)],{stdio:'inherit'});
  if(result.status!==0) process.exit(result.status||1);
}
