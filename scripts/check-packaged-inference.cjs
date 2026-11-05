'use strict';
const path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(process.argv[2]);
const result=spawnSync(require('electron'),[path.join(__dirname,'utility-check.cjs'),path.join(root,'resources','app.asar')],{
  stdio:'inherit',timeout:90000,env:{...process.env,SCANNER_MODEL_CACHE:path.join(root,'resources','bundled-models')},
});
if(result.error)throw result.error;
process.exit(result.status??1);
