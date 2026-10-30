/**
 * 外部浏览器页面脚本 —— 经 Runtime.evaluate 在用户真实 Chrome/Edge 的标签页里执行。
 *
 * 与内嵌浏览器（desktop/main.cjs 的 SNAPSHOT_SCRIPT 等）遵守同一约定：
 * 交互元素统一打 `data-jarvis-ref="N"` 标记，agent 看到 [N] 后按 ref 回指。
 * 注意：这里是有意的精简实现，只覆盖 agent 端到端所需动作；它**不是**安全策略
 * （安全策略只有一份：shared/browser-url-policy），两边快照文本的排版差异不影响
 * 安全性，但会改变 agent 看到的页面描述 —— 若日后要完全对齐，应把内嵌侧的
 * 脚本也提取到 shared 共用，而不是在这里继续堆功能。
 *
 * 所有脚本都返回 JSON 字符串（而不是对象），让 Runtime.evaluate 的结果解析
 * 只有一条路径，异常形状统一。
 */

/** 把要拼进脚本字符串的值安全地序列化为 JS 字面量。 */
function jsString(value: unknown): string {
  return JSON.stringify(String(value ?? ""));
}

function jsRef(ref: unknown): string {
  const n = Number(ref);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`invalid jarvis ref: ${String(ref)}`);
  }
  return String(n);
}

const CLEAR_REFS = "document.querySelectorAll('[data-jarvis-ref]').forEach(function(el){el.removeAttribute('data-jarvis-ref');});";

/**
 * 页面快照：标题 + URL + 前几个标题 + 可见交互元素（带 [ref] 编号）。
 * 输出文本格式与内嵌侧保持同构（agent 的提示词约定不区分后端）。
 */
export function snapshotExpression(): string {
  return `(function(){${CLEAR_REFS}
var ref=0,lines=[];
var title=document.title||"(untitled)";
lines.push("# "+title);
lines.push(location.href);
lines.push("");
var heads=document.querySelectorAll("h1,h2,h3");
for(var i=0;i<heads.length&&i<12;i++){var t=(heads[i].innerText||"").trim();if(t){lines.push(heads[i].tagName.toLowerCase()+" "+t);}}
var els=document.querySelectorAll("a[href],button,input,textarea,select,[role=\\"button\\"],[role=\\"link\\"],[contenteditable=\\"true\\"],summary");
for(var i=0;i<els.length;i++){
  var el=els[i];var r=el.getBoundingClientRect();
  if(!r||r.width<1||r.height<1)continue;
  ref++;el.setAttribute("data-jarvis-ref",String(ref));
  var tag=el.tagName.toLowerCase();
  var label=(el.innerText||el.value||el.getAttribute("aria-label")||el.getAttribute("placeholder")||el.getAttribute("href")||"").trim().replace(/\\s+/g," ").slice(0,80);
  var type=tag==="input"?(el.getAttribute("type")||"text"):"";
  lines.push("["+ref+"] "+tag+(type?"("+type+")":"")+(label?" "+label:""));
  if(ref>=200)break;
}
return JSON.stringify({url:location.href,title:title,text:lines.join("\\n")});})()`;
}

/** 点击指定 ref 的元素。 */
export function clickExpression(ref: unknown): string {
  return `(function(){var el=document.querySelector('[data-jarvis-ref="${jsRef(ref)}"]');
if(!el)return JSON.stringify({ok:false,error:"ref not found (page may have changed; take a fresh snapshot)"});
el.scrollIntoView({block:"center"});
el.click();
return JSON.stringify({ok:true});})()`;
}

/** 在指定 ref 的输入控件里填入文本（触发 input/change，兼容受控组件）。 */
export function typeExpression(ref: unknown, text: unknown, pressEnter: boolean): string {
  return `(function(){var el=document.querySelector('[data-jarvis-ref="${jsRef(ref)}"]');
if(!el)return JSON.stringify({ok:false,error:"ref not found (page may have changed; take a fresh snapshot)"});
el.scrollIntoView({block:"center"});
el.focus();
var value=${jsString(text)};
if(el.isContentEditable){el.innerText=value;}else{
  var proto=el.tagName==="TEXTAREA"?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;
  var setter=Object.getOwnPropertyDescriptor(proto,"value");
  if(setter&&setter.set){setter.set.call(el,value);}else{el.value=value;}
}
el.dispatchEvent(new Event("input",{bubbles:true}));
el.dispatchEvent(new Event("change",{bubbles:true}));
${pressEnter ? `["keydown","keypress","keyup"].forEach(function(type){el.dispatchEvent(new KeyboardEvent(type,{key:"Enter",code:"Enter",bubbles:true}));});` : ""}
return JSON.stringify({ok:true});})()`;
}

/** 滚动页面（amount 是"屏"的近似单位，与内嵌侧语义一致）。 */
export function scrollExpression(direction: unknown, amount: unknown): string {
  const dir = String(direction || "down").toLowerCase() === "up" ? -1 : 1;
  const n = Number.isFinite(Number(amount)) ? Math.min(Math.abs(Number(amount)), 20) : 3;
  return `(function(){window.scrollBy(0,${dir * n}*Math.max(window.innerHeight*0.8,200));return JSON.stringify({ok:true,y:window.scrollY});})()`;
}

/** 在 select 控件上选中一个值。 */
export function selectExpression(ref: unknown, value: unknown): string {
  return `(function(){var el=document.querySelector('[data-jarvis-ref="${jsRef(ref)}"]');
if(!el||el.tagName!=="SELECT")return JSON.stringify({ok:false,error:"ref is not a <select>"});
el.value=${jsString(value)};
el.dispatchEvent(new Event("input",{bubbles:true}));
el.dispatchEvent(new Event("change",{bubbles:true}));
return JSON.stringify({ok:true,value:el.value});})()`;
}

/** 向当前焦点元素发一个按键事件序列。 */
export function pressKeyExpression(key: unknown): string {
  return `(function(){var el=document.activeElement||document.body;
var key=${jsString(key)};
["keydown","keypress","keyup"].forEach(function(type){el.dispatchEvent(new KeyboardEvent(type,{key:key,code:key,bubbles:true}));});
return JSON.stringify({ok:true});})()`;
}

/** 探测选择器是否存在（wait 轮询用）。 */
export function hasSelectorExpression(selector: unknown): string {
  return `(function(){return JSON.stringify({found:!!document.querySelector(${jsString(selector)})});})()`;
}

/** 探测正文是否包含某段文本（wait 轮询用）。 */
export function hasTextExpression(text: unknown): string {
  return `(function(){return JSON.stringify({found:(document.body&&document.body.innerText||"").indexOf(${jsString(text)})!==-1});})()`;
}

/** 读取当前页面地址与标题。 */
export function locationExpression(): string {
  return `(function(){return JSON.stringify({url:location.href,title:document.title||""});})()`;
}
