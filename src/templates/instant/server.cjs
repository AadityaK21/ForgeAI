const http=require("node:http"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const esbuild=require("esbuild"),postcss=require("postcss"),tailwind=require("tailwindcss");
const {openStore}=require("./store.cjs");
async function start(){
 const js=await esbuild.build({entryPoints:["runtime/main.tsx"],bundle:true,write:false,jsx:"automatic",minify:true,define:{"process.env.NODE_ENV":'"production"'}});
 const css=await postcss([tailwind({content:["./src/**/*.{ts,tsx}"],corePlugins:{preflight:true}})]).process("@tailwind base;@tailwind components;@tailwind utilities;\n"+(fs.existsSync("src/styles.css")?fs.readFileSync("src/styles.css","utf8"):""),{from:undefined});
 const store=openStore(process.env.DATABASE_FILE||"app.sqlite",JSON.parse(fs.readFileSync("forge.schema.json","utf8")));
 const html='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
 const server=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,"http://localhost");
   if(url.pathname.startsWith("/api/")){
    let body="",size=0;for await(const chunk of req){size+=chunk.length;if(size>16000){res.writeHead(413).end();return;}body+=chunk.toString();}
    let parsed;if(body){try{parsed=JSON.parse(body)}catch{res.writeHead(400).end("Invalid JSON");return;}}
    const result=store.request(req.method,url.pathname,parsed);
    res.writeHead(result.status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}).end(JSON.stringify(result.body));return;
   }
   if(req.method!=="GET"){res.writeHead(405).end();return;}
   if(url.pathname==="/app.js"){res.writeHead(200,{"content-type":"text/javascript"}).end(js.outputFiles[0].text);return;}
   if(url.pathname==="/app.css"){res.writeHead(200,{"content-type":"text/css"}).end(css.css);return;}
   res.writeHead(200,{"content-type":"text/html; charset=utf-8"}).end(html);
  }catch{res.writeHead(500).end("Request failed.");}
 });
 server.listen(Number(process.env.PORT||3000),process.env.HOST||"127.0.0.1",()=>console.log("Application listening on "+server.address().port));
}
start().catch(e=>{console.error(e.message);process.exitCode=1;});
