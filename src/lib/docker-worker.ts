import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { safePath } from "./artifact-parser";
import type { Event, Worker } from "./engine";

const image = "merova-node-sandbox:22-bookworm-v1";
const dockerfile =
  "FROM node:22-bookworm-slim\nRUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*\nUSER node\n";
type Options = {
  stdin?: string;
  timeout?: number;
  signal?: AbortSignal;
  outputLimit?: number;
  log?: (type: "stdout" | "stderr", text: string) => void;
};
// No model-controlled command is interpreted by the host shell.
function docker(args: string[], opts: Options = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const cliEnvironment = { ...globalThis.process.env };
    for (const key of [
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "E2B_API_KEY",
      "BUILDER_ACCESS_TOKEN",
      "DATABASE_URL",
    ])
      delete cliEnvironment[key];
    const process = spawn("docker", args, {
      env: cliEnvironment,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      signal: opts.signal,
    });
    let output = "",
      timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      process.kill();
    }, opts.timeout ?? 20000);
    const collect = (type: "stdout" | "stderr") => (chunk: Buffer) => {
      const s = chunk.toString();
      output = (output + s).slice(-(opts.outputLimit ?? 9000));
      opts.log?.(type, s);
    };
    process.stdout.on("data", collect("stdout"));
    process.stderr.on("data", collect("stderr"));
    process.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    process.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output.trim());
      else
        reject(
          Error(
            timedOut
              ? "The sandbox command timed out."
              : output.trim() || "Docker command failed.",
          ),
        );
    });
    process.stdin.on("error", () => {});
    process.stdin.end(opts.stdin);
  });
}
export async function dockerReady() {
  try {
    const os = await docker(["info", "--format", "{{.OSType}}"], {
      timeout: 7000,
    });
    return os === "linux";
  } catch {
    return false;
  }
}
const proxyProgram = `
const http=require('node:http'), net=require('node:net');
const allowed=new Set(['registry.npmjs.org','binaries.prisma.sh','nodejs.org','registry.yarnpkg.com']);
const proxy=http.createServer((q,r)=>r.writeHead(403).end());
proxy.on('connect',(req,client,head)=>{
 const [host,port]=req.url.toLowerCase().split(':');
 if(!allowed.has(host)||port!=='443'){client.end('HTTP/1.1 403 Forbidden\\r\\n\\r\\n');return;}
 const upstream=net.connect(443,host,()=>{client.write('HTTP/1.1 200 Connection Established\\r\\n\\r\\n');if(head.length)upstream.write(head);client.pipe(upstream);upstream.pipe(client);});
 upstream.on('error',()=>client.destroy());client.on('error',()=>upstream.destroy());client.on('close',()=>upstream.destroy());
});
net.createServer(client=>{const upstream=net.connect(3000,process.argv[1]);client.pipe(upstream);upstream.pipe(client);upstream.on("error",()=>client.destroy());client.on("error",()=>upstream.destroy());client.on("close",()=>upstream.destroy());}).listen(3000,"0.0.0.0");
proxy.listen(3128,'0.0.0.0');setTimeout(()=>process.exit(),910000);
`;
const writeProgram = `
const fs=require('node:fs'),path=require('node:path');
const chunks=[];process.stdin.on('data',c=>chunks.push(c)).on('end',()=>{
 const {name,content}=JSON.parse(Buffer.concat(chunks));let dir=process.cwd();
 for(const segment of name.split('/').slice(0,-1)){dir=path.join(dir,segment);if(!fs.existsSync(dir))fs.mkdirSync(dir);if(!fs.lstatSync(dir).isDirectory())throw Error('Unsafe directory in generated project');}
 const dest=path.join(process.cwd(),name);
 if(fs.existsSync(dest)&&(!fs.lstatSync(dest).isFile()||fs.lstatSync(dest).nlink!==1))throw Error('Unsafe file in generated project');
 const fd=fs.openSync(dest,fs.constants.O_NOFOLLOW|fs.constants.O_WRONLY|fs.constants.O_TRUNC|fs.constants.O_CREAT,0o600);
 try{fs.writeFileSync(fd,content);}finally{fs.closeSync(fd);}
});
`;
const probeProgram = `
const fs = require('node:fs/promises');
async function run(){
 let result = 'Port 3000 did not accept a connection.';
 const deadline=Date.now()+65000;
 while(Date.now()<deadline){
   let res;
   try{res=await fetch('http://127.0.0.1:3000/',{redirect:'manual',signal:AbortSignal.timeout(Math.max(1000,deadline-Date.now()))});}catch{
     await new Promise(r=>setTimeout(r,500));continue;
   }
   if(res.status>=200 && res.status<400)return;
   result='GET / returned HTTP '+res.status+' '+(await res.text()).replace(/<[^>]*>/g,' ').replace(/\\s+/g,' ').slice(-900);
   break;
 }
 const log=await fs.readFile('/tmp/merova-server.log','utf8').catch(()=>'');
 throw Error(result+'\\n'+log.slice(-4800));
}
run().catch(e=>{console.error(e.message);process.exitCode=1});
`;
export async function destroyDocker(id: string) {
  if (!/^local-[0-9a-f-]{36}$/.test(id)) return;
  await Promise.allSettled([
    docker(["rm", "-f", id]),
    docker(["rm", "-f", id + "-proxy"]),
  ]);
  await docker(["network", "rm", id]).catch(() => {});
}
export async function createDockerWorker(
  projectId: string,
  emit: (e: Event) => void,
  signal: AbortSignal,
) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(projectId))
    throw Error("Invalid sandbox project ID.");
  const id = "local-" + randomUUID(),
    cwd = "/tmp/.sandboxes/" + projectId;
  const proxy = id + "-proxy",
    proxyUrl = "http://" + proxy + ":3128";
  const limits = [
    "--rm",
    "--detach",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--user",
    "1000:1000",
    "--pids-limit",
    "192",
  ];
  const run = (args: string[], options: Options = {}) =>
    docker(args, { signal, ...options });
  const exec = (cmd: string[], options: Options = {}) =>
    run(["exec", "-i", "-w", cwd, id, ...cmd], options);
  const log = (type: "stdout" | "stderr", text: string) => emit({ type, text });
  try {
    // Docker removes timed-out workers even when the studio closes. Collect
    // only their old, unused private networks on the next local build.
    await run([
      "network",
      "prune",
      "--force",
      "--filter",
      "label=merova.builder=local",
      "--filter",
      "until=20m",
    ]).catch(() => {});
    try {
      await run(["image", "inspect", "--format", "{{.Id}}", image]);
    } catch {
      emit({
        type: "stage",
        text: "Preparing the Node and SQLite sandbox image",
      });
      await run(["build", "--tag", image, "-"], {
        stdin: dockerfile,
        timeout: 180000,
        log,
      });
    }
    await run([
      "network",
      "create",
      "--internal",
      "--label",
      "merova.builder=local",
      id,
    ]);
    // Only this small registry proxy gets egress. Generated processes have no
    // host mounts, Docker socket, provider keys, or external network interface.
    await run(
      [
        "run",
        ...limits,
        "--name",
        proxy,
        "-p",
        "127.0.0.1::3000",
        "--memory",
        "96m",
        "--cpus",
        "0.3",
        image,
        "node",
        "-e",
        proxyProgram,
        id,
      ],
      { timeout: 120000 },
    );
    await run(["network", "connect", id, proxy]);
    await run([
      "run",
      ...limits,
      "--init",
      "--name",
      id,
      "--network",
      id,
      "--memory",
      "3400m",
      "--memory-swap",
      "3400m",
      "--cpus",
      "2",
      "--tmpfs",
      "/tmp:rw,exec,nosuid,nodev,size=2400m,mode=1777",
      "-e",
      "HOME=/tmp/home",
      "-e",
      "CI=1",
      "-e",
      "NEXT_TELEMETRY_DISABLED=1",
      "-e",
      "NEXT_IGNORE_INCORRECT_LOCKFILE=1",
      "-e",
      "HTTPS_PROXY=" + proxyUrl,
      "-e",
      "HTTP_PROXY=" + proxyUrl,
      "-e",
      "npm_config_https_proxy=" + proxyUrl,
      "-e",
      "NO_PROXY=127.0.0.1,localhost",
      image,
      "sleep",
      "900",
    ]);
    await run(["exec", id, "mkdir", "-p", cwd, "/tmp/home"]);
    const port = (await run(["port", proxy, "3000/tcp"])).match(
      /^127\.0\.0\.1:(\d+)$/,
    )?.[1];
    if (!port) throw Error("Could not obtain the loopback preview port.");
    const worker: Worker = {
      async read(name) {
        safePath(name);
        const script =
          "const f=require('fs'),p=require('path');const file=f.realpathSync(process.argv[1]);if(!file.startsWith(process.cwd()+p.sep)||f.statSync(file).size>500000)throw Error('Unsafe source');process.stdout.write(JSON.stringify(f.readFileSync(file,'utf8')))";
        return JSON.parse(
          await exec(["node", "-e", script, name], { outputLimit: 3100000 }),
        ) as string;
      },
      async list() {
        const script =
          "const f=require('fs');const out=[],q=[''];for(let i=0;i<q.length && i<300;i++){for(const e of f.readdirSync(q[i]||'.',{withFileTypes:true})){if(['node_modules','.next','.git'].includes(e.name))continue;const n=q[i]+e.name;if(e.isFile()&&out.length<500)out.push(n);if(e.isDirectory()&&q.length<300)q.push(n+'/')}}process.stdout.write(JSON.stringify(out))";
        return JSON.parse(
          await exec(["node", "-e", script], { outputLimit: 200000 }),
        ) as string[];
      },
      async write(name, content) {
        safePath(name);
        await exec(["node", "-e", writeProgram], {
          stdin: JSON.stringify({ name, content }),
        });
      },
      async run(command) {
        // timeout runs inside the worker and terminates its process group,
        // including npm children, before a repair can touch the same install.
        await exec(["timeout", "--kill-after=5", "175", "sh", "-ec", command], {
          timeout: 185000,
          log,
        });
      },
      async start(command) {
        // Downloaded tarballs can otherwise occupy as much RAM as node_modules
        // for the lifetime of a tmpfs preview.
        await exec([
          "node",
          "-e",
          "require('node:fs').rmSync('/tmp/home/.npm/_cacache',{recursive:true,force:true})",
        ]);
        await run([
          "exec",
          "-d",
          "-w",
          cwd,
          id,
          "sh",
          "-c",
          'echo $$ > /tmp/merova-server.pid; exec setsid sh -c "$1" >/tmp/merova-server.log 2>&1',
          "builder",
          command,
        ]);
        await exec(["node", "-e", probeProgram], { timeout: 75000, log });
      },
      async stop() {
        await exec([
          "sh",
          "-c",
          'if test -s /tmp/merova-server.pid; then pid=$(cat /tmp/merova-server.pid); kill -TERM -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true; fi',
        ]).catch(() => {});
      },
    };
    return {
      worker,
      id,
      url: "http://" + id + ".localhost:" + port,
      release: async (success: boolean) => {
        if (success) setTimeout(() => void destroyDocker(id), 905000).unref();
        else await destroyDocker(id);
      },
    };
  } catch (error) {
    await destroyDocker(id);
    throw error;
  }
}
