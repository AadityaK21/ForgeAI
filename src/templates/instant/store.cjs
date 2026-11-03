const { DatabaseSync } = require("node:sqlite");
const { randomUUID } = require("node:crypto");
const keyPattern=/^[A-Za-z][A-Za-z0-9_]{0,39}$/;
function validKey(s){return keyPattern.test(s)&&!["__proto__","constructor","prototype"].includes(s);}
function schemaTables(schema){
 if(!schema || typeof schema.tables!=="object" || Array.isArray(schema.tables)||!schema.tables)throw Error("forge.schema.json needs a tables object.");
 const tables=Object.entries(schema.tables);
 if(tables.length>40)throw Error("Use at most 40 tables.");
 for(const [name,t] of tables){
  if(!validKey(name)||!t||!t.fields||typeof t.fields!=="object"||Array.isArray(t.fields)||Object.keys(t.fields).length>60)throw Error("Invalid table: "+name);
  for(const [key,type] of Object.entries(t.fields))if(!validKey(key)||key==="id"||!["string","number","boolean"].includes(type))throw Error("Invalid field: "+name+"."+key);
  if(t.seed!==undefined && (!Array.isArray(t.seed)||t.seed.length>200))throw Error("Invalid seed data for "+name);
  for(const row of t.seed||[])validate(t,row);
 }
 return schema.tables;
}
function validate(table, input){
 if(!input||typeof input!=="object"||Array.isArray(input)||JSON.stringify(input).length>16000)throw Error("Supply a JSON object up to 16 KB.");
 for(const [key,value] of Object.entries(input)){
  if(key==="id"){if(typeof value!=="string"|| !/^[a-zA-Z0-9_-]{1,80}$/.test(value))throw Error("Invalid record ID.");continue;}
  if(!Object.hasOwn(table.fields,key)||typeof value!==table.fields[key] || (typeof value==="number"&&!Number.isFinite(value)))throw Error("Invalid field: "+key);
 }
 return input;
}
function openStore(filename,schema){
 const tables=schemaTables(schema);
 const db=new DatabaseSync(filename);
 try{
 db.exec("PRAGMA busy_timeout=4000; CREATE TABLE IF NOT EXISTS records (collection TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(collection,id)); CREATE TABLE IF NOT EXISTS seeded (name TEXT PRIMARY KEY); BEGIN IMMEDIATE");
 const init=db.prepare("INSERT OR IGNORE INTO seeded(name) VALUES(?)"), insert=db.prepare("INSERT OR IGNORE INTO records VALUES(?,?,?)");
 for(const [name,t] of Object.entries(tables))if(init.run(name).changes)for(const input of t.seed||[]){
   const id=input.id||randomUUID();insert.run(name,id,JSON.stringify({...input,id}));
 }
 db.exec("COMMIT");
 }catch(e){db.close();throw e;}
 function request(method,path,body){
  const match=/^\/api\/data\/([A-Za-z][\w]{0,39})(?:\/([A-Za-z0-9_-]{1,80}))?\/?$/.exec(path.split("?")[0]);
  if(!match|| !Object.hasOwn(tables,match[1]))return {status:404,body:{error:"Unknown collection."}};
  const [,name,id]=match; const table=tables[name];
  const one=(id)=>db.prepare("SELECT data FROM records WHERE collection=? AND id=?").get(name,id);
  if(method==="GET"){
   if(!id)return {status:200,body:db.prepare("SELECT data FROM records WHERE collection=? ORDER BY rowid LIMIT 1000").all(name).map(row=>JSON.parse(row.data))};
   const found=one(id);return found?{status:200,body:JSON.parse(found.data)}:{status:404,body:{error:"Record not found."}};
  }
  if(method==="DELETE"&&id)return db.prepare("DELETE FROM records WHERE collection=? AND id=?").run(name,id).changes?{status:200,body:{id}}:{status:404,body:{error:"Record not found."}};
  if(!(method==="POST"&&!id || ["PUT","PATCH"].includes(method)&&id))return {status:405,body:{error:"Unsupported method."}};
  try{validate(table,body);}catch(e){return {status:400,body:{error:e.message}};}
  const uid=id||body.id||randomUUID();
  if(body.id && uid!==body.id)return {status:400,body:{error:"Record ID differs from URL."}};
  db.exec("BEGIN IMMEDIATE");
  try{
    const old=one(uid);
    if(method==="POST" && (old || db.prepare("SELECT count(*) AS n FROM records WHERE collection=?").get(name).n>=1000)){db.exec("ROLLBACK");return {status:409,body:{error:"Duplicate record or collection is full."}};}
    if(id&&!old){db.exec("ROLLBACK");return {status:404,body:{error:"Record not found."}};}
    const record={...(method==="PATCH" ? JSON.parse(old.data) : {}),...body,id:uid};
    db.prepare("INSERT INTO records VALUES(?,?,?) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data").run(name,uid,JSON.stringify(record));
    db.exec("COMMIT");return {status:id?200:201,body:record};
  }catch(e){db.exec("ROLLBACK");throw e;}
 }
 return {request,close:()=>db.close()};
}
module.exports={schemaTables,openStore};
