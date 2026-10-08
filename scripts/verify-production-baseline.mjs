import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const baseline=JSON.parse(await readFile(new URL('ops/production-baseline.json',root),'utf8'));
const failures=[];
for(const file of baseline.files){
 try{const data=await readFile(new URL(file.path,root));if(createHash('sha1').update(data).digest('hex')!==file.uid)failures.push(file.path);}
 catch{failures.push(file.path+' (missing)');}
}
if(failures.length){console.error('Sources differ from the approved production baseline:\n'+failures.join('\n'));process.exit(1);}
console.log(`${baseline.files.length} source files match ${baseline.deploymentId}. This does not authorize deployment.`);
