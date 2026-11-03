import ts from "typescript";

// Installed only in the disposable runtime copy, never the saved customer source.
const bridgePath = "__forge_preview_inspector.js";
export const INSPECTOR_SCRIPT = String.raw`
(() => {
  if (window.parent === window || !document.referrer) return;
  const studio = new URL(document.referrer).origin;
  const kind = "forge-inspector-v1";
  let channel, active = false, target, box, original;
  function send(type, data = {}) {
    parent.postMessage({kind, channel, type, ...data}, studio);
  }
  function selector(node) {
    if (node.id) return "#" + CSS.escape(node.id);
    const parts = [];
    for (let el=node; el && el !== document.documentElement; el=el.parentElement) {
      if (el.id) { parts.unshift("#" + CSS.escape(el.id)); break; }
      const tag=el.localName;
      const siblings=Array.from(el.parentElement?.children || []).filter(n=>n.localName===tag);
      parts.unshift(tag + (siblings.length>1 ? ":nth-of-type("+(siblings.indexOf(el)+1)+")" : ""));
    }
    return parts.join(" > ").slice(0,500);
  }
  function reset() {
    if (!original || !target) return;
    if(original.text !== null) target.textContent = original.text;
    for(const [key, value, priority] of original.styles){
      if(value) target.style.setProperty(key,value,priority);
      else target.style.removeProperty(key);
    }
    original = undefined;
  }
  function highlight(el) {
    if(!el || el===box || !active) return;
    if(!box) {
      box=document.createElement("div");box.setAttribute("aria-hidden","true");
      box.style.cssText="position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #f77739;background:rgba(246,120,56,.10);box-sizing:border-box";
      document.documentElement.append(box);
    }
    const r=el.getBoundingClientRect();
    Object.assign(box.style,{top:r.top+"px",left:r.left+"px",width:r.width+"px",height:r.height+"px"});
  }
  function clear() {reset();target=undefined;box?.remove();box=undefined;}
  document.addEventListener("pointerover",e=>{if(active && e.target instanceof HTMLElement) highlight(e.target);},true);
  document.addEventListener("click",e=>{
    if(!active || !(e.target instanceof HTMLElement)) return;
    e.preventDefault();e.stopImmediatePropagation();reset();target=e.target;
    const editable=target.childElementCount===0 && !target.matches("input,textarea,select,script,style,html,body,canvas,iframe,video,img,svg,br,hr") && !target.isContentEditable;
    highlight(target);
    send("selected",{selector:selector(target),tag:target.localName,path:(document.documentElement.dataset.forgePage||(location.hash.startsWith("#/")?location.hash.slice(1):location.pathname)).slice(0,300),
      text:editable ? (target.textContent||"").slice(0,250) : "", editable});
  },true);
  document.addEventListener("submit",e=>{if(active){e.preventDefault();e.stopImmediatePropagation();}},true);
  document.addEventListener("keydown",e=>{if(active && e.key==="Escape"){active=false;clear();send("exit");}},true);
  window.addEventListener("message",e=>{
    const m=e.data;
    if(e.source!==parent || e.origin!==studio || !m || m.kind!==kind) return;
    if(m.type==="mode" && typeof m.channel==="string" && m.channel.length<=80) {
      channel=m.channel;active=m.active===true;clear();send("ready");return;
    }
    if(!active || !target || channel!==m.channel)return;
    if(m.type==="reset"){reset();highlight(target);return;}
    if(m.type!=="try")return;
    reset();
    const editable=target.childElementCount===0 && !target.matches("input,textarea,select,script,style,html,body,canvas,iframe,video,img,svg,br,hr") && !target.isContentEditable;
    original={text:editable&&typeof m.text==="string"?target.textContent:null,styles:["color","background-color"].map(k=>[k,target.style.getPropertyValue(k),target.style.getPropertyPriority(k)])};
    if(original.text!==null) target.textContent=m.text.slice(0,250);
    for(const [name,value] of [["color",m.color],["background-color",m.background]]) if(/^#[0-9a-f]{6}$/i.test(String(value)))target.style.setProperty(name,value,"important");
    highlight(target);
  });
  send("boot");
})();`;

export function previewFiles(files: Record<string, string>) {
  const copies = { ...files };
  const filename = Object.keys(files).find((p) =>
    /^(src\/)?app\/layout\.(tsx|jsx|js)$/.test(p),
  );
  if (!filename) return copies;
  const source = ts.createSourceFile(
    filename,
    files[filename],
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const insertions: number[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxClosingElement(node) && node.tagName.getText(source) === "body")
      insertions.push(node.getStart(source));
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!insertions.length) return copies;
  let name = bridgePath;
  while (Object.hasOwn(files, "public/" + name)) name = "_" + name;
  for (const at of insertions.sort((a, b) => b - a)) {
    copies[filename] =
      copies[filename].slice(0, at) +
      '<script src="/' +
      name +
      '" defer></script>' +
      copies[filename].slice(at);
  }
  copies["public/" + name] = INSPECTOR_SCRIPT;
  return copies;
}
