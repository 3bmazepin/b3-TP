// ==UserScript==
// @name         b3 自動TP鹵獲
// @namespace    b3-auto-tp-capture
// @version      v6.24
// @description  自動TP鹵獲
// @match        https://*.3gokushi.jp/village.php*
// @match        https://*.3gokushi.jp/card/deck.php*
// @grant        none
// ==/UserScript==
(function(){
'use strict';
const PREFIX='bro3_tp_auto_';
const KEY={
X:PREFIX+'target_x',
Y:PREFIX+'target_y',
LABEL:PREFIX+'heal_label',
CARDS:PREFIX+'selected_cards',
PANEL_X:PREFIX+'panel_x',
PANEL_Y:PREFIX+'panel_y',
COLLAPSED:PREFIX+'collapsed',
FIRST_WAIT:PREFIX+'first_wait',
RECHECK_WAIT:PREFIX+'recheck_wait',
SKILL_WAIT:PREFIX+'skill_wait',
SKILL_GAP:PREFIX+'skill_gap',
MAIN_X:PREFIX+'main_x',MAIN_Y:PREFIX+'main_y',MAIN_BOOKMARK:PREFIX+'main_bm',
SUB_X:PREFIX+'sub_x',SUB_Y:PREFIX+'sub_y',SUB_BOOKMARK:PREFIX+'sub_bm',
HP_HEAL:PREFIX+'hp_heal'
};
const DEFAULT_X=985;
const DEFAULT_Y=-1125;
const DEFAULT_FIRST_WAIT=20;
const DEFAULT_RECHECK_WAIT=10;
const DEFAULT_SKILL_WAIT=2.5;
const DEFAULT_SKILL_GAP=1.5;
const AUTO_OPERATION_ENABLED=true;
let autoRunning=false;
let stopRequested=false;
let cycleCount=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function getHTML(url){
const res=await fetch(url,{
method:'GET',
credentials:'same-origin',
cache:'no-store'
});
if(!res.ok)throw new Error(`GET失敗 ${res.status}: ${url}`);
return await res.text();
}
function toDoc(html){
return new DOMParser().parseFromString(html,'text/html');
}
function normalizeText(s){
return String(s??'').replace(/\s+/g,' ').trim();
}
function loadJSON(key,def){
try{
const v=localStorage.getItem(key);
return v?JSON.parse(v):def;
}catch{
return def;
}
}
function saveJSON(key,value){
localStorage.setItem(key,JSON.stringify(value));
}
function setStatus(text,type=''){
const el=document.getElementById('bro3-tp-status');
if(!el)return;
el.textContent=text;
el.style.color=
type==='error'?'#ff8585':
type==='ok'?'#8dff8d':
type==='work'?'#ffe36e':'#fff';
}
async function getBookmarks(){
const doc=toDoc(await getHTML('/map_bookmark.php'));
const results=[];
for(const row of doc.querySelectorAll('tr')){
let x=null,y=null;
for(const a of row.querySelectorAll('a')){
const text=normalizeText(a.textContent);
const matches=[...text.matchAll(/\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/g)];
if(matches.length){
const m=matches[matches.length-1];
x=Number(m[1]);
y=Number(m[2]);
break;
}
const href=a.getAttribute('href')||'';
const mx=href.match(/[?&]x=(-?\d+)/);
const my=href.match(/[?&]y=(-?\d+)/);
if(mx&&my){
x=Number(mx[1]);
y=Number(my[1]);
break;
}
}
if(x===null||y===null)continue;
const input=row.querySelector('input[type="text"], input:not([type])');
const name=input?.value?.trim()||`(${x},${y})`;
const favorite=[...row.querySelectorAll('input[type="checkbox"]')].some(c=>c.checked);
results.push({name,x,y,favorite});
}
const unique=new Map();
for(const b of results)unique.set(`${b.x},${b.y}`,b);
return[...unique.values()];
}
async function getLabels(){
const doc=toDoc(await getHTML('/card/deck.php'));
const labels=new Map();
for(const a of doc.querySelectorAll('#tab-labels a[href*="l="], a[href*="/card/deck.php"][href*="l="]')){
const href=a.getAttribute('href')||'';
const m=href.match(/[?&]l=(\d+)/);
if(!m)continue;
const id=m[1];
const name=normalizeText(a.textContent);
if(name&&!labels.has(id))labels.set(id,{id,name});
}
return[...labels.values()];
}
async function getDeckCards(){
const doc=toDoc(await getHTML('/card/deck.php'));
const result=[];
const seen=new Set();
const globalNameMap=new Map();
for(const el of doc.querySelectorAll('[onclick*="operationExecution"]')){
const onclick=el.getAttribute('onclick')||'';
const m=onclick.match(
/operationExecution\s*\(\s*(['"])(.*?)\1\s*,\s*(\d+)/
);
if(m){
const name=normalizeText(m[2]);
const id=String(m[3]);
if(name&&id&&!globalNameMap.has(id)){
globalNameMap.set(id,name);
}
}
}
function addCard(cardId,name,box){
cardId=String(cardId||'');
name=normalizeText(name);
if(!/^\d+$/.test(cardId)||seen.has(cardId))return;
const text=normalizeText(box?.innerText||box?.textContent||'');
if(/内政官|内政中|内政設定中/.test(text)){
return;
}
if(!name)name=`カードID:${cardId}`;
seen.add(cardId);
result.push({id:cardId,name});
}
function getName(box,cardId){
cardId=String(cardId||'');
if(globalNameMap.has(cardId)){
return globalNameMap.get(cardId);
}
if(!box)return'';
for(const el of box.querySelectorAll('[onclick*="operationExecution"]')){
const onclick=el.getAttribute('onclick')||'';
const m=onclick.match(/operationExecution\s*\(\s*(['"])(.*?)\1\s*,\s*(\d+)/);
if(m&&String(m[3])===String(cardId)&&normalizeText(m[2])){
return normalizeText(m[2]);
}
}
const lines=String(box.innerText||box.textContent||'')
.split(/\r?\n/)
.map(v=>v.trim())
.filter(Boolean);
return lines.find(line=>
!/^HP\s*\d+/i.test(line)&&
!/^討伐ゲ/.test(line)&&
!/^\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?$/.test(line)&&
!/^\d+(?:\.\d+)?$/.test(line)&&
line!=='待機中'&&
line!=='デッキから外す'&&
!/^-?\d+\s*,\s*-?\d+$/.test(line)&&
!/デッキコスト|自動鹵獲/.test(line)
)||'';
}
for(const area of doc.querySelectorAll(
'#cardListDeck .deck_all_tab .deck-all-tab-element[data-deck-kind="1"]'
)){
for(const box of area.querySelectorAll('.deck-all-card')){
const idEl=box.querySelector('[data-card-id]');
const cardId=idEl?.getAttribute('data-card-id');
if(!cardId)continue;
addCard(cardId,getName(box,cardId),box);
}
}
for(const dd of doc.querySelectorAll('#cardListDeck .deck_tab dd')){
if(!/待機中/.test(normalizeText(dd.textContent)))continue;
const scope=
dd.closest('.cardStatusDetail, [class*="cardStatusDetail"], li, .deck-card, .card')||
dd.parentElement;
let cardId='';
const idEl=scope?.querySelector?.('[data-card-id]');
if(idEl)cardId=idEl.getAttribute('data-card-id')||'';
if(!cardId){
const links=[
...(scope?.querySelectorAll?.('a[href]')||[]),
...dd.querySelectorAll('a[href]')
];
for(const a of links){
const href=a.getAttribute('href')||'';
let m=
href.match(/village_id%3D\d+%26card_id%3D(\d+)/i)||
href.match(/[?&]card_id=(\d+)/i)||
href.match(/card_id%3D(\d+)/i)||
href.match(/cardWindow_(\d+)/i);
if(m){
cardId=m[1];
break;
}
}
}
if(!cardId)continue;
const html=scope?.outerHTML||'';
if(
/deck_mode(?:=|%3D)2/i.test(html)||
/data-deck-kind=["']2["']/i.test(html)||
/警護デッキ/.test(normalizeText(scope?.textContent))
){
continue;
}
addCard(cardId,getName(scope,cardId),scope);
}
return result;
}
function addStyle(){
const style=document.createElement('style');
style.textContent=`
#bro3-tp-panel{position:fixed;z-index:999999;width:410px;max-height:calc(100vh - 24px);overflow-y:auto;overflow-x:hidden;background:rgba(35,25,20,.97);border:2px solid #d0a33a;border-radius:8px;color:#fff;font-size:13px;font-family:sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.55)}
#bro3-tp-title{position:sticky;top:0;z-index:10;padding:8px 10px;background:linear-gradient(#8c291f,#58150f);font-size:15px;font-weight:bold;cursor:move;user-select:none}
#bro3-tp-collapse{float:right;cursor:pointer;border:0;color:#fff;background:transparent;font-weight:bold}
#bro3-tp-body{padding:7px}
.bro3-tp-section{border-top:1px solid #76634b;margin-top:5px;padding-top:5px}
.bro3-tp-section:first-child{border-top:none;margin-top:0}
.bro3-tp-label{color:#ffd96a;font-weight:bold;margin-bottom:3px}
#bro3-tp-panel select,#bro3-tp-panel input[type="number"]{background:#fff;color:#111;border:1px solid #777;border-radius:3px;height:32px;font-size:14px}
#bro3-tp-bookmark,#bro3-tp-heal-label{width:100%;margin-bottom:5px}
.bro3-tp-coordinate{display:flex;align-items:center;gap:5px}
.bro3-tp-coordinate input{width:75px}
.bro3-tp-btn{cursor:pointer;border:1px solid #c79b32;border-radius:4px;background:linear-gradient(#7b6431,#493715);color:#fff;min-height:32px;padding:5px 9px;margin:2px}
.bro3-tp-btn:hover{filter:brightness(1.2)}
#bro3-tp-cards{height:145px;overflow-y:auto;overflow-x:auto;white-space:nowrap;border:1px solid #655746;background:rgba(0,0,0,.28);padding:4px}
.bro3-tp-card{display:flex;align-items:center;white-space:nowrap;height:25px;padding:1px 3px;border-bottom:1px dotted #5d5144;cursor:pointer}
.bro3-tp-card:hover{background:rgba(255,255,255,.08)}
.bro3-tp-card-check{margin-right:5px}
.bro3-tp-card-id{display:inline-block;width:75px;flex:0 0 75px;color:#ddd;font-family:Consolas,monospace;font-size:12px}
.bro3-tp-card-name{display:inline-block;white-space:nowrap;color:#fff;font-size:12px}
.bro3-tp-time-row{display:flex;align-items:center;margin:4px 0}
.bro3-tp-time-title{display:inline-block;width:90px}
.bro3-tp-time{width:55px;text-align:right;margin-right:5px}
#bro3-tp-statusbox{background:#171717;border:1px solid #555;padding:7px;margin-top:6px;line-height:1.7}
#bro3-tp-test-warning{color:#ffce63;font-weight:bold}
.bro3-tp-start{width:215px;padding:9px;font-weight:bold;background:linear-gradient(#278a3e,#145c27)}
.bro3-tp-stop{padding:9px;background:linear-gradient(#9d3030,#641a1a)}
`;
document.head.appendChild(style);
}
function createPanel(){
if(document.getElementById('bro3-tp-panel'))return;
const x=Number(localStorage.getItem(KEY.PANEL_X)??20);
const y=Number(localStorage.getItem(KEY.PANEL_Y)??20);
const targetX=localStorage.getItem(KEY.X)??DEFAULT_X;
const targetY=localStorage.getItem(KEY.Y)??DEFAULT_Y;
const mainX=localStorage.getItem(KEY.MAIN_X)??targetX,mainY=localStorage.getItem(KEY.MAIN_Y)??targetY;
const subX=localStorage.getItem(KEY.SUB_X)??targetX,subY=localStorage.getItem(KEY.SUB_Y)??targetY;
const firstWait=Number(localStorage.getItem(KEY.FIRST_WAIT)??DEFAULT_FIRST_WAIT);
const recheckWait=Number(localStorage.getItem(KEY.RECHECK_WAIT)??DEFAULT_RECHECK_WAIT);
const skillWait=Number(localStorage.getItem(KEY.SKILL_WAIT)??DEFAULT_SKILL_WAIT);
const skillGap=Number(localStorage.getItem(KEY.SKILL_GAP)??DEFAULT_SKILL_GAP);
const hpHealEnabled=localStorage.getItem(KEY.HP_HEAL)!=='0';
const panel=document.createElement('div');
panel.id='bro3-tp-panel';
panel.style.left=`${x}px`;
panel.style.top=`${y}px`;
panel.innerHTML=`
<div id="bro3-tp-title">
 自動TP鹵獲 <span style="font-size:11px">v0.6.24</span>
 <button id="bro3-tp-collapse">－</button>
</div>
<div id="bro3-tp-body">
 <div id="bro3-tp-test-warning">※使用可能な回復スキルのみ使用・回復中武将は自動除外</div>

 <div class="bro3-tp-section">
  <div class="bro3-tp-label">■ 鹵獲出兵先</div>
  <div style="font-size:11px">本拠デッキ</div>
  <select id="bro3-tp-main-bookmark"><option>取得中...</option></select>
  <div class="bro3-tp-coordinate">X <input id="bro3-tp-main-x" type="number" value="${mainX}"> Y <input id="bro3-tp-main-y" type="number" value="${mainY}"></div>
  <div style="font-size:11px;margin-top:5px">拠点デッキ</div>
  <select id="bro3-tp-sub-bookmark"><option>取得中...</option></select>
  <div class="bro3-tp-coordinate">X <input id="bro3-tp-sub-x" type="number" value="${subX}"> Y <input id="bro3-tp-sub-y" type="number" value="${subY}"> <button class="bro3-tp-btn" id="bro3-tp-reload-bookmark">再取得</button></div>
 </div>

 <div class="bro3-tp-section">
  <div class="bro3-tp-label">■ 鹵獲出兵武将 <span id="bro3-tp-card-count"></span></div>
  <div>
   <button class="bro3-tp-btn" id="bro3-tp-select-all">全選択</button>
   <button class="bro3-tp-btn" id="bro3-tp-select-none">全解除</button>
   <button class="bro3-tp-btn" id="bro3-tp-reload-cards">デッキ再取得</button>
  </div>
  <div id="bro3-tp-cards">デッキ武将取得中...</div>
 </div>

 <div class="bro3-tp-section">
  <div class="bro3-tp-label">■ 回復設定</div>
  <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
   <span>ラベル</span><select id="bro3-tp-heal-label" style="flex:1;min-width:150px"><option>取得中...</option></select>
   <span>HP回復</span><select id="bro3-tp-hp-heal" style="width:72px"><option value="1" ${hpHealEnabled?'selected':''}>する</option><option value="0" ${!hpHealEnabled?'selected':''}>しない</option></select>
  </div>
  <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:3px;font-size:11px">
   <span>スキル後</span><input id="bro3-tp-skill-wait" class="bro3-tp-time" type="number" min="0.1" max="30" step="0.1" value="${skillWait}"><span>秒</span>
   <span>次間隔</span><input id="bro3-tp-skill-gap" class="bro3-tp-time" type="number" min="0" max="30" step="0.1" value="${skillGap}"><span>秒</span>
   <span>傾国3回</span>
  </div>
 </div>

 <div class="bro3-tp-section">
  <div class="bro3-tp-label">■ 帰還確認</div>
  <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
   初回 <input id="bro3-tp-first-wait" class="bro3-tp-time" type="number" min="1" max="3600" value="${firstWait}">秒
   再確認 <input id="bro3-tp-recheck-wait" class="bro3-tp-time" type="number" min="1" max="3600" value="${recheckWait}">秒
  </div>
 </div>

 <div class="bro3-tp-section">
  <div class="bro3-tp-label">■ 状態</div>
  <div id="bro3-tp-statusbox">
   状態：<span id="bro3-tp-status">読み込み中</span><br>
   出兵：<span id="bro3-tp-progress">0 / 0</span><br>
   回復：HP 0回　傾国 0/3
  </div>
 </div>

 <div class="bro3-tp-section" style="text-align:center">
  <button id="bro3-tp-start" class="bro3-tp-btn bro3-tp-start">▶ TP出兵スタート</button>
  <button id="bro3-tp-stop" class="bro3-tp-btn bro3-tp-stop">■ 停止</button>
 </div>
</div>`;
document.body.appendChild(panel);
enableDrag(panel);
bindUI();
setCollapsed(localStorage.getItem(KEY.COLLAPSED)==='1');
}
function setCollapsed(collapsed){
const body=document.getElementById('bro3-tp-body');
const btn=document.getElementById('bro3-tp-collapse');
if(!body||!btn)return;
body.style.display=collapsed?'none':'block';
btn.textContent=collapsed?'＋':'－';
localStorage.setItem(KEY.COLLAPSED,collapsed?'1':'0');
}
function enableDrag(panel){
const title=document.getElementById('bro3-tp-title');
let dragging=false,offsetX=0,offsetY=0;
title.addEventListener('mousedown',e=>{
if(e.target.id==='bro3-tp-collapse'||e.button!==0)return;
dragging=true;
const r=panel.getBoundingClientRect();
offsetX=e.clientX-r.left;
offsetY=e.clientY-r.top;
e.preventDefault();
});
document.addEventListener('mousemove',e=>{
if(!dragging)return;
let x=Math.max(0,Math.min(window.innerWidth-panel.offsetWidth,e.clientX-offsetX));
let y=Math.max(0,Math.min(window.innerHeight-35,e.clientY-offsetY));
panel.style.left=`${x}px`;
panel.style.top=`${y}px`;
});
document.addEventListener('mouseup',()=>{
if(!dragging)return;
dragging=false;
const r=panel.getBoundingClientRect();
localStorage.setItem(KEY.PANEL_X,Math.round(r.left));
localStorage.setItem(KEY.PANEL_Y,Math.round(r.top));
});
}
function bindUI(){
document.getElementById('bro3-tp-collapse').addEventListener('click',e=>{
e.stopPropagation();
const body=document.getElementById('bro3-tp-body');
setCollapsed(body.style.display!=='none');
});
[['bro3-tp-main-x',KEY.MAIN_X],['bro3-tp-main-y',KEY.MAIN_Y],['bro3-tp-sub-x',KEY.SUB_X],['bro3-tp-sub-y',KEY.SUB_Y]].forEach(([id,key])=>document.getElementById(id).addEventListener('change',e=>localStorage.setItem(key,e.target.value)));
document.getElementById('bro3-tp-hp-heal').addEventListener('change',e=>localStorage.setItem(KEY.HP_HEAL,e.target.value));
document.getElementById('bro3-tp-first-wait').addEventListener('change',e=>{
let v=Math.floor(Number(e.target.value));
if(!Number.isFinite(v)||v<1)v=DEFAULT_FIRST_WAIT;
e.target.value=v;
localStorage.setItem(KEY.FIRST_WAIT,v);
});
document.getElementById('bro3-tp-recheck-wait').addEventListener('change',e=>{
let v=Math.floor(Number(e.target.value));
if(!Number.isFinite(v)||v<1)v=DEFAULT_RECHECK_WAIT;
e.target.value=v;
localStorage.setItem(KEY.RECHECK_WAIT,v);
});
const bindWait=(id,key,def,min)=>{
document.getElementById(id).addEventListener('change',e=>{
let v=Number(e.target.value);
if(!Number.isFinite(v)||v<min)v=def;
v=Math.round(v*10)/10;
e.target.value=v;
localStorage.setItem(key,v);
});
};
bindWait('bro3-tp-skill-wait',KEY.SKILL_WAIT,DEFAULT_SKILL_WAIT,0.1);
bindWait('bro3-tp-skill-gap',KEY.SKILL_GAP,DEFAULT_SKILL_GAP,0);
document.getElementById('bro3-tp-reload-bookmark').addEventListener('click',loadBookmarksUI);
document.getElementById('bro3-tp-reload-cards').addEventListener('click',loadCardsUI);
document.getElementById('bro3-tp-select-all').addEventListener('click',()=>{
document.querySelectorAll('.bro3-tp-card-check').forEach(c=>c.checked=true);
saveSelectedCards();
updateCardCount();
});
document.getElementById('bro3-tp-select-none').addEventListener('click',()=>{
document.querySelectorAll('.bro3-tp-card-check').forEach(c=>c.checked=false);
saveSelectedCards();
updateCardCount();
});
document.getElementById('bro3-tp-start').addEventListener('click',startAutoRun);
document.getElementById('bro3-tp-stop').addEventListener('click',()=>{
stopRequested=true;
autoRunning=false;
setStatus('停止要求：現在の通信完了後に停止します','error');
});
}
async function loadBookmarksUI(){
const list=await getBookmarks();
for(const type of['main','sub']){
const sel=document.getElementById(`bro3-tp-${type}-bookmark`);
sel.innerHTML='';
const key=type==='main'?KEY.MAIN_BOOKMARK:KEY.SUB_BOOKMARK;
const saved=localStorage.getItem(key);
list.forEach(b=>{const o=document.createElement('option');o.value=`${b.x},${b.y}`;o.textContent=`${b.favorite?'★ ':''}${b.name} (${b.x},${b.y})`;sel.appendChild(o);});
let ix=list.findIndex(b=>`${b.x},${b.y}`===saved);if(ix<0)ix=list.findIndex(b=>b.favorite);if(ix<0)ix=0;
sel.selectedIndex=ix;applyBookmark(list[ix],type);
sel.onchange=()=>{const[x,y]=sel.value.split(',').map(Number);applyBookmark(list.find(b=>b.x===x&&b.y===y),type);};
}
}
function applyBookmark(b,type){
if(!b)return;const main=type==='main';
document.getElementById(main?'bro3-tp-main-x':'bro3-tp-sub-x').value=b.x;
document.getElementById(main?'bro3-tp-main-y':'bro3-tp-sub-y').value=b.y;
localStorage.setItem(main?KEY.MAIN_X:KEY.SUB_X,b.x);localStorage.setItem(main?KEY.MAIN_Y:KEY.SUB_Y,b.y);
localStorage.setItem(main?KEY.MAIN_BOOKMARK:KEY.SUB_BOOKMARK,`${b.x},${b.y}`);
}
async function loadLabelsUI(){
const select=document.getElementById('bro3-tp-heal-label');
select.innerHTML='<option>取得中...</option>';
try{
const labels=await getLabels();
select.innerHTML='';
if(!labels.length){
select.innerHTML='<option value="">取得できませんでした</option>';
return;
}
const saved=localStorage.getItem(KEY.LABEL);
for(const label of labels){
const o=document.createElement('option');
o.value=label.id;
o.textContent=label.name;
if(saved===label.id)o.selected=true;
select.appendChild(o);
}
if(!saved){
const target=labels.find(l=>l.name.trim()==='被無神医1');
if(target)select.value=target.id;
}
localStorage.setItem(KEY.LABEL,select.value);
select.onchange=()=>localStorage.setItem(KEY.LABEL,select.value);
}catch(e){
console.error('[自動TP] ラベル',e);
select.innerHTML='<option value="">取得エラー</option>';
setStatus('ラベル取得エラー','error');
}
}
async function loadCardsUI(){
const box=document.getElementById('bro3-tp-cards');
box.textContent='通常デッキ武将取得中...';
try{
const cards=await getDeckCards();
const saved=loadJSON(KEY.CARDS,[]);
const hasSaved=localStorage.getItem(KEY.CARDS)!==null;
box.innerHTML='';
if(!cards.length){
box.innerHTML='<span style="color:#ff8585">通常デッキ武将を取得できませんでした</span>';
updateCardCount();
return;
}
for(const card of cards){
const label=document.createElement('label');
label.className='bro3-tp-card';
const check=document.createElement('input');
check.type='checkbox';
check.className='bro3-tp-card-check';
check.value=card.id;
check.checked=!hasSaved||saved.includes(card.id);
check.addEventListener('change',()=>{
saveSelectedCards();
updateCardCount();
});
const id=document.createElement('span');
id.className='bro3-tp-card-id';
id.textContent=card.id;
const name=document.createElement('span');
name.className='bro3-tp-card-name';
name.textContent=card.name;
label.append(check,id,name);
box.appendChild(label);
}
saveSelectedCards();
updateCardCount();
}catch(e){
console.error('[自動TP] 武将取得',e);
box.innerHTML=`<span style="color:#ff8585">武将取得エラー：${String(e.message)}</span>`;
setStatus('デッキ武将取得エラー','error');
}
}
function saveSelectedCards(){
const ids=[...document.querySelectorAll('.bro3-tp-card-check:checked')].map(c=>c.value);
saveJSON(KEY.CARDS,ids);
}
function updateCardCount(){
const all=document.querySelectorAll('.bro3-tp-card-check').length;
const selected=document.querySelectorAll('.bro3-tp-card-check:checked').length;
const count=document.getElementById('bro3-tp-card-count');
if(count)count.textContent=`（${selected}/${all}体）`;
const progress=document.getElementById('bro3-tp-progress');
if(progress)progress.textContent=`0 / ${selected}`;
}
function getCookieValue(name){
const prefix=name+'=';
for(const part of document.cookie.split(';')){
const v=part.trim();
if(v.startsWith(prefix))return decodeURIComponent(v.slice(prefix.length));
}
return'';
}
function parseSkillListQuery(queryString){
if(!queryString)return[];
const entries=new URLSearchParams(queryString).entries();
const list=[];
let obj=null;
while(true){
const r=entries.next();
if(r.done)break;
const[key,value]=r.value;
if(key==='index'){
if(obj!==null)list.push(obj);
obj={};
}
if(obj!==null)obj[key]=value;
}
if(obj!==null)list.push(obj);
return list;
}
function skillLevel(name){
const m=String(name||'').match(/LV\s*(\d+)/i);
return m?Number(m[1]):0;
}
const HP_RECOVERY_SKILL_RE=/(仁君|弓腰姫の愛|桃色吐息|神医の施術|神医の術式|発憤興起|酔吟吐息|神卜の方術)/;
function isHpRecoverySkill(name){
return HP_RECOVERY_SKILL_RE.test(String(name||''))&&skillLevel(name)>=9;
}
function isKeikoku(name){
return/傾国/.test(String(name||''))&&skillLevel(name)>=9;
}
function findCardId(card){
const data=card.getAttribute('data-card-id')||
card.querySelector('[data-card-id]')?.getAttribute('data-card-id');
if(data&&/^\d+$/.test(data))return data;
for(const a of card.querySelectorAll('a[href]')){
const href=a.getAttribute('href')||'';
const m=href.match(/cardWindow_(\d+)/);
if(m)return m[1];
}
return'';
}
function findCardName(card){
return normalizeText(
card.querySelector('[class^="illustMini__div--name"]')?.textContent||
card.querySelector('[class*="illustMini__div--name"]')?.textContent||
''
);
}
function findSkillQuery(card){
const a=card.querySelector('div.set a.control__button--deck-set-small')||
card.querySelector('a.control__button--deck-set-small');
return a?.getAttribute('href')||'';
}
function findRecoveryCardCost(card){
const parse=value=>{const m=String(value??'').normalize('NFKC').trim().match(/^(?:(?:コスト|COST)\s*[:：]?\s*)?(\d+(?:\.\d+)?)$/i);return m&&Number(m[1])>0?Number(m[1]):NaN;};
const resolve=values=>{const unique=[...new Set(values)];return unique.length===1&&Number.isFinite(unique[0])?unique[0]:NaN;};
const cells=[...card.querySelectorAll('table.statusParameter1 th')].filter(el=>/^(?:コスト|COST)$/i.test(String(el.textContent||'').normalize('NFKC').trim()));
if(cells.length)return resolve(cells.map(el=>el.nextElementSibling?.tagName==='TD'?parse(el.nextElementSibling.textContent):NaN));
const values=[];
for(const el of [card,...card.querySelectorAll('[data-cost],[data-card-cost],[class*="illustMini__div--cost"],.cardCost,.card-cost')]){
for(const attr of ['data-cost','data-card-cost']){const raw=el.getAttribute(attr);if(raw!==null)values.push(parse(raw));}
if(el!==card&&el.getAttribute('data-cost')===null&&el.getAttribute('data-card-cost')===null)values.push(parse(el.textContent));
}
return resolve(values);
}
const excludedRecoveryCards=new Set();
async function getRecoveryCandidates(labelId){
const found=new Map();
for(let page=1;page<=20;page++){
const html=await getHTML(`/card/deck.php?p=${page}&l=${encodeURIComponent(labelId)}`);
const doc=toDoc(html);
const cards=[...doc.querySelectorAll(
'#cardFileList div.cardStatusDetail.label-setting-mode, '+
'#cardFileList div[class="cardStatusDetail label-setting-mode"]'
)];
if(!cards.length)break;
let added=0;
for(const card of cards){
const cardId=findCardId(card);
if(!cardId||found.has(cardId)||excludedRecoveryCards.has(String(cardId)))continue;
const cost=findRecoveryCardCost(card);
if(!Number.isFinite(cost)||cost<=0)continue;
const query=findSkillQuery(card);
const skills=parseSkillListQuery(query);
if(!skills.length)continue;
const usable=skills.filter(sk=>
sk.card_id&&sk.skill_id&&
String(sk.freeze_flg??'0')==='0'
);
const hpHeal=usable.find(sk=>isHpRecoverySkill(sk.skill_name));
const keikoku=usable.find(sk=>isKeikoku(sk.skill_name));
if(hpHeal||keikoku){
found.set(cardId,{
cardId,cost,
name:findCardName(card)||`ID:${cardId}`,
hpHeal:hpHeal||null,
keikoku:keikoku||null
});
added++;
}
}
const hasNext=[...doc.querySelectorAll('a[href]')].some(a=>{
const href=a.getAttribute('href')||'';
return new RegExp(`[?&]p=${page + 1}(?:&|$)`).test(href);
});
if(!hasNext)break;
}
return[...found.values()];
}
async function getRecoveryVillageId(){
const html=await getHTML('/card/deck.php');
const doc=toDoc(html);
const raw=(doc.querySelector('#villages')?.textContent||'').trim();
if(!raw)throw new Error('ビヨンド式の拠点一覧 #villages が取得できません（安全停止）');
let villages;
try{
villages=JSON.parse(raw);
}catch(e){
const cleaned=raw.replace(/;\s*$/,'').replace(/([{,]\s*)([a-zA-Z_][\w]*)(\s*:)/g,'$1"$2"$3')
.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g,(_m,v)=>JSON.stringify(v));
try{villages=JSON.parse(cleaned);}
catch(_){throw new Error('拠点一覧の解析に失敗（安全停止）');}
}
const entries=Object.values(villages||{}).filter(v=>v&&typeof v==='object');
const vacant={1:0,2:0};
doc.querySelectorAll('#cardListDeck .deck_tab .state span.volume').forEach(el=>{
const kind=Number(el.getAttribute('data-deck-kind')||el.dataset?.deckKind);
const m=(el.textContent||'').match(/([\d.]+)\s*\/\s*([\d.]+)/);
if((kind===1||kind===2)&&m)vacant[kind]=Math.max(0,Number(m[2])-Number(m[1]));
});
const first={1:null,2:null};
for(const v of entries){
const kind=Number(v.deck_kind);
const id=String(v.village_id||'');
if((kind===1||kind===2)&&/^\d+$/.test(id)&&
(v.isset_domestic===false||v.isset_domestic===0||v.isset_domestic==='0')&&!first[kind]){
first[kind]=id;
}
}
if(Math.max(vacant[1],vacant[2])<1)throw new Error('必要な空きデッキコストがありません');
const possible=[1,2].filter(kind=>first[kind]&&vacant[kind]>=1);
if(!possible.length){
console.warn('[自動TP] 回復用拠点候補なし',{vacant,first,villageCount:entries.length});
throw new Error('内政官不在かつ空きコストのある回復用拠点がありません（安全停止）');
}
possible.sort((a,b)=>vacant[b]-vacant[a]||a-b);
const kind=possible[0],villageId=first[kind];
return{villageId,deckMode:kind,vacantCost:vacant[kind]};
}
async function postForm(url,params){
const body=new URLSearchParams();
for(const[k,v]of Object.entries(params))body.append(k,String(v));
const res=await fetch(url,{
method:'POST',
credentials:'same-origin',
cache:'no-store',
headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'},
body
});
if(!res.ok)throw new Error(`POST失敗 HTTP ${res.status}`);
return await res.text();
}
function recoveryWaitMs(id,def){
const v=Number(document.getElementById(id)?.value);
return Math.round((Number.isFinite(v)?v:def)*1000);
}
async function attemptRecoverySkill(card,skill,origin){
const{villageId,deckMode,vacantCost}=origin;
if(!Number.isFinite(vacantCost)||vacantCost<1)throw new Error('必要な空きデッキコストがありません');
if(![1,2].includes(deckMode)||!/^\d+$/.test(String(villageId)))throw new Error('回復拠点を確認できません');
if(!Number.isFinite(card.cost)||card.cost<=0||card.cost>vacantCost)throw new Error('回復武将が空きデッキコストに収まりません');
if(!skill?.skill_id)throw new Error(`${card.name}: スキルIDがありません`);
if(!skill?.card_id)throw new Error(`${card.name}: スキル側card_idがありません`);
const targetCardId=String(skill.card_id);
const ssid=getCookieValue('SSID');
if(!ssid)throw new Error('SSIDを取得できません');
const params={
ssid,
target_card:targetCardId,
mode:'domestic_set',
deck_mode:deckMode,
action_type:2,
'choose_attr1_skills[]':skill.skill_id
};
params[`selected_village[${targetCardId}]`]=villageId;
const html=await postForm('/card/deck.php',params);
const d=toDoc(html);
const err=normalizeText(
d.querySelector('.error, .errorMessage, .notice-error, #error, .red')?.textContent||''
);
const responseText=normalizeText(d.body?.textContent||'').slice(0,600);
if(err&&/(エラー|できません|失敗|不足|使用でき|発動でき)/.test(err)){
throw new Error(`${skill.skill_name}: ${err.slice(0, 120)}`);
}
await sleep(recoveryWaitMs('bro3-tp-skill-wait',DEFAULT_SKILL_WAIT));
const latest=await getRecoveryCandidates(document.getElementById('bro3-tp-heal-label')?.value||'');
const same=latest.find(c=>String(c.cardId)===String(card.cardId));
const stillUsable=latest.some(c=>{
if(String(c.cardId)!==String(card.cardId))return false;
const sk=isKeikoku(skill.skill_name)?c.keikoku:c.hpHeal;
return sk&&String(sk.skill_id)===String(skill.skill_id);
});
if(stillUsable){
const error=new Error(`${card.name} の ${skill.skill_name} は使用可能なままです`);
error.recoveryUnconfirmed=true;throw error;
}
}
async function activateRecoverySkill(card,skill,origin){
const type=isKeikoku(skill.skill_name)?'keikoku':'hpHeal';
while(!stopRequested){
try{await attemptRecoverySkill(card,skill,origin);return;}catch(error){
if(!error.recoveryUnconfirmed)throw error;
excludedRecoveryCards.add(String(card.cardId));
setStatus(`${card.name}を回復候補から除外：次の武将を確認中`,'work');
}
if(stopRequested)return;
origin=await getRecoveryVillageId();
const cards=await getRecoveryCandidates(document.getElementById('bro3-tp-heal-label')?.value||'');
card=cards.find(c=>c[type]&&c.cost<=origin.vacantCost&&!excludedRecoveryCards.has(String(c.cardId)));
if(!card)throw new Error('除外した武将以外に、空きデッキコストに収まる使用可能な回復武将がありません');
skill=card[type];
setStatus(`回復武将を変更：${card.name}`,'work');
}
}
function collectRenderedSubdue(doc,ids){
const wanted=new Set(ids.map(String));
const found=new Map();
const conflicts=new Set();
function readGauge(scope){
const raw=String(scope?.innerText||'').normalize('NFKC').replace(/\s+/g,' ');
const matches=[...raw.matchAll(/討伐\s*ゲ[ー－-]?ジ\s*[:：]?\s*(\d{1,3})(?!\d)/g)]
.map(m=>Number(m[1])).filter(n=>n>=0&&n<=500);
const distinct=[...new Set(matches)];
return distinct.length===1?distinct[0]:null;
}
function add(id,scope){
if(!wanted.has(id))return;
const val=readGauge(scope);
if(val===null)return;
if(found.has(id)&&found.get(id)!==val){conflicts.add(id);return;}
found.set(id,val);
}
for(const card of doc.querySelectorAll('.deck-all-card')){
const cardIds=[...new Set([...card.querySelectorAll('[data-card-id]')]
.map(e=>e.getAttribute('data-card-id')).filter(Boolean))];
const targets=cardIds.filter(id=>wanted.has(id));
if(targets.length===1)add(targets[0],card);
}
for(const dd of doc.querySelectorAll('#cardListDeck .deck_tab dd')){
if(!/待機中/.test(dd.textContent||''))continue;
const scope=dd.closest('.cardStatusDetail, [class*="cardStatusDetail"], li, .deck-card, .card')||dd.parentElement;
if(!scope)continue;
const html=scope.outerHTML||'';
if(/deck_mode(?:=|%3D)2/i.test(html)||/data-deck-kind=["']2["']/i.test(html)||/警護デッキ/.test(scope.textContent||''))continue;
let id=scope.querySelector('[data-card-id]')?.getAttribute('data-card-id')||'';
if(!id){
for(const link of[...scope.querySelectorAll('a[href]'),...dd.querySelectorAll('a[href]')]){
const href=link.getAttribute('href')||'';
const m=href.match(/village_id%3D\d+%26card_id%3D(\d+)/i)||href.match(/[?&]card_id=(\d+)/i)||href.match(/card_id%3D(\d+)/i)||href.match(/cardWindow_(\d+)/i);
if(m){id=m[1];break;}
}
}
if(!wanted.has(id))continue;
let node=scope;
for(let depth=0;depth<3&&node;depth++,node=node.parentElement){
const otherIds=[...new Set([...node.querySelectorAll('[data-card-id]')].map(e=>e.getAttribute('data-card-id')).filter(Boolean))];
if(otherIds.some(other=>other!==id&&wanted.has(other)))break;
const val=readGauge(node);
if(val!==null){add(id,node);break;}
}
}
for(const id of conflicts)found.delete(id);
return found;
}
async function getSelectedCardSubdue(ids){
const wanted=ids.map(String);
const direct=collectRenderedSubdue(document,wanted);
if(direct.size===wanted.length)return direct;
const nonce=`${Date.now()}_${Math.random().toString(36).slice(2)}`;
const frame=document.createElement('iframe');
frame.style.cssText='position:fixed!important;left:-20000px!important;top:0!important;width:1400px!important;height:1000px!important;border:0!important;pointer-events:none!important';
frame.setAttribute('aria-hidden','true');
frame.setAttribute('tabindex','-1');
let onMessage;
let timeout;
try{
const response=new Promise((resolve,reject)=>{
onMessage=event=>{
if(event.origin!==location.origin||event.source!==frame.contentWindow)return;
const data=event.data;
if(!data||data.type!=='bro3-tp-subdue-result'||data.nonce!==nonce)return;
resolve(data);
};
window.addEventListener('message',onMessage);
timeout=setTimeout(()=>reject(new Error('デッキ画面の討伐値取得がタイムアウト（通信または描画に失敗）')),16000);
});
document.body.appendChild(frame);
frame.src=`/card/deck.php?bro3_tp_probe=${encodeURIComponent(nonce)}&bro3_tp_ids=${encodeURIComponent(wanted.join(','))}`;
const data=await response;
const result=new Map();
for(const[id,val]of Object.entries(data.values||{})){
if(wanted.includes(id)&&Number.isFinite(val)&&val>=0&&val<=500)result.set(id,val);
}
return result;
}finally{
clearTimeout(timeout);
if(onMessage)window.removeEventListener('message',onMessage);
frame.remove();
}
}
function startSubdueProbe(){
const params=new URLSearchParams(location.search);
const nonce=params.get('bro3_tp_probe');
if(!nonce||location.pathname!=='/card/deck.php')return false;
const ids=(params.get('bro3_tp_ids')||'').split(',').filter(id=>/^\d+$/.test(id));
let attempts=0;
const timer=setInterval(()=>{
attempts++;
const result=collectRenderedSubdue(document,ids);
if(result.size!==ids.length&&attempts<40)return;
clearInterval(timer);
window.parent.postMessage({type:'bro3-tp-subdue-result',nonce,values:Object.fromEntries(result)},location.origin);
},250);
return true;
}
async function useOneKeikoku(labelId){
const cards=await getRecoveryCandidates(labelId);
const villageId=await getRecoveryVillageId();
const card=cards.find(c=>c.keikoku&&c.cost<=villageId.vacantCost);
if(!card)throw new Error('空きデッキコストに収まる傾国LV9以上の武将が見つかりません');
setStatus(`討伐500未満：${card.name} の傾国を1回使用`,'work');
await activateRecoverySkill(card,card.keikoku,villageId);
await sleep(recoveryWaitMs('bro3-tp-skill-gap',DEFAULT_SKILL_GAP));
}
async function waitUntilSubdue500(ids,recheckSec,labelId){
const getValues=async()=>{
const gauges=await getSelectedCardSubdue(ids);
const unknown=ids.filter(id=>!gauges.has(String(id)));
if(unknown.length)throw new Error(`討伐値を判定できない武将：${unknown.join(', ')}`);
return Math.min(...ids.map(id=>gauges.get(String(id))));
};
let minimum=await getValues();
if(minimum>=500)return true;
let casts=0;
while(minimum<500){
if(stopRequested)return false;
const needed=Math.ceil((500-minimum)/147);
if(casts>=4||needed>4-casts){
throw new Error(`討伐回復が想定外です（最低${minimum}、傾国${casts}回済）。安全停止`);
}
setStatus(`討伐最低${minimum}：傾国あと${needed}回予定（実行${casts}/4）`,'work');
await useOneKeikoku(labelId);
if(stopRequested)return false;
const next=await getValues();
if(next<=minimum)throw new Error(`傾国使用後に討伐値が増えていません（${minimum}→${next}）。発動未確認のため安全停止`);
casts++;
minimum=next;
}
setStatus(`討伐500確認済み（傾国${casts}回）：出兵へ`,'ok');
return true;
}
function getSelectedCardIds(){
return[...document.querySelectorAll('.bro3-tp-card-check:checked')].map(c=>String(c.value));
}
async function getWaitingCardVillageMap(){
const doc=toDoc(await getHTML('/card/deck.php'));
const map=new Map();
const mainIds=new Set([...doc.querySelectorAll('#cardListDeck .deck_all_tab .deck-all-tab-element[data-deck-kind="1"] [data-card-id]')].map(e=>String(e.getAttribute('data-card-id'))));
for(const dd of doc.querySelectorAll('#cardListDeck .deck_tab dd')){
if(!/待機中/.test(normalizeText(dd.textContent)))continue;
const scope=dd.closest('.cardStatusDetail, [class*="cardStatusDetail"], li, .deck-card, .card')||dd.parentElement;
const html=scope?.outerHTML||'';
if(/deck_mode(?:=|%3D)2/i.test(html)||/data-deck-kind=["']2["']/i.test(html)||/警護デッキ/.test(normalizeText(scope?.textContent)))continue;
for(const a of[...(scope?.querySelectorAll?.('a[href]')||[]),...dd.querySelectorAll('a[href]')]){
const href=a.getAttribute('href')||'';
const dec=decodeURIComponent(href);
const vm=dec.match(/[?&]village_id=(\d+)/);
const cm=dec.match(/[?&]card_id=(\d+)/)||dec.match(/cardWindow_(\d+)/);
if(vm&&cm&&!map.has(String(cm[1])))map.set(String(cm[1]),{villageId:String(vm[1]),deckType:mainIds.has(String(cm[1]))?'main':'sub'});
}
}
return map;
}
async function changeVillage(villageId){
if(!villageId)throw new Error('出兵元拠点IDがありません');
await getHTML(`/village_change.php?village_id=${encodeURIComponent(villageId)}`);
await sleep(250);
}
function analyzeSortieResponse(html){
const doc=toDoc(html);
const text=normalizeText(doc.body?.innerText||'');
const explicit=normalizeText(doc.querySelector('.error, .errorMessage, .notice-error, #error, .red')?.textContent||'');
const combined=`${explicit} ${text}`;
if(/鹵獲/.test(combined)&&/(上限|制限|回数).{0,30}(到達|超え|終了|できません|不可)|(?:上限|制限).{0,30}鹵獲/.test(combined)){
return{ok:false,limit:true,message:'TP鹵獲の出兵制限に到達'};
}
if(explicit&&/(エラー|できません|失敗|不足|出兵でき|選択してください)/.test(explicit)){
return{ok:false,limit:false,message:explicit.slice(0,160)};
}
return{ok:true,limit:false,message:''};
}
async function sendCapture(cardId,villageId,x,y){
await changeVillage(villageId);
const params={
village_x_value:x,
village_y_value:y,
unit_assign_card_id:cardId,
radio_move_type:'307',
deck_mode:'1',
radio_reserve_type:'0',
radio_enhanced_loyalty_attack:0,
btn_send:'出兵',
card_id:'204'
};
const html=await postForm('/facility/castle_send_troop.php',params);
return analyzeSortieResponse(html);
}
async function waitInterruptible(sec){
const end=Date.now()+Math.max(0,sec)*1000;
while(Date.now()<end){
if(stopRequested||!autoRunning)return false;
await sleep(Math.min(500,end-Date.now()));
}
return true;
}
async function allSortiedCardsReturned(ids){
const cards=await getDeckCards();
const waiting=new Set(cards.map(c=>String(c.id)));
return ids.every(id=>waiting.has(String(id)));
}
async function getSelectedCardHp(ids){
const doc=toDoc(await getHTML('/card/deck.php'));
const wanted=new Set(ids.map(String)),result=new Map();
function inspect(scope,id){
if(!scope||result.has(id))return;
const text=normalizeText(scope.textContent||'');
const m=text.match(/HP\s*[:：]?\s*(\d+)\s*\/\s*(\d+)/i)||
text.match(/HP\s*[:：]?\s*(\d+)/i);
if(m)result.set(id,Number(m[1]));
}
for(const el of doc.querySelectorAll('[data-card-id]')){
const id=String(el.getAttribute('data-card-id')||'');
if(!wanted.has(id))continue;
inspect(el.closest('.deck-all-card, .cardStatusDetail, [class*="cardStatusDetail"], li, .card')||el.parentElement,id);
}
for(const dd of doc.querySelectorAll('#cardListDeck .deck_tab dd')){
const scope=dd.closest('.cardStatusDetail, [class*="cardStatusDetail"], li, .deck-card, .card')||dd.parentElement;
const html=scope?.outerHTML||'';
for(const id of wanted){
if(!result.has(id)&&new RegExp(`(?:card_id(?:=|%3D)|cardWindow_)${id}(?:\\D|$)`,'i').test(html))inspect(scope,id);
}
}
return result;
}
async function performHpRecovery(labelId,ids){
if(document.getElementById('bro3-tp-hp-heal')?.value!=='1')return 0;
const hp=await getSelectedCardHp(ids);
const unknown=ids.filter(id=>!hp.has(String(id)));
if(unknown.length)throw new Error(`HPを取得できない武将があります：${unknown.join(', ')}`);
const minHp=Math.min(...ids.map(id=>hp.get(String(id))));
const count=Math.max(0,Math.ceil((100-minHp)/20));
if(count===0){
setStatus('全員HP100：HP回復なし','ok');
return 0;
}
for(let n=0;n<count;n++){
if(stopRequested)return n;
const cards=await getRecoveryCandidates(labelId);
const villageId=await getRecoveryVillageId();
const healer=cards.find(c=>c.hpHeal&&c.cost<=villageId.vacantCost);
if(!healer)throw new Error(`HP回復があと${count-n}回必要ですが、空きデッキコストに収まるHP回復スキルがありません`);
setStatus(`HP回復 ${n+1}/${count}：${healer.name}`,'work');
await activateRecoverySkill(healer,healer.hpHeal,villageId);
await sleep(recoveryWaitMs('bro3-tp-skill-gap',DEFAULT_SKILL_GAP));
}
return count;
}
async function performRecovery(labelId,selectedIds){
await performHpRecovery(labelId,selectedIds);
if(stopRequested)return false;
for(let n=0;n<3;n++){
const cards=await getRecoveryCandidates(labelId);
const villageId=await getRecoveryVillageId();
const card=cards.find(c=>c.keikoku&&c.cost<=villageId.vacantCost);
if(!card)throw new Error(`傾国があと${3-n}回必要ですが、空きデッキコストに収まる傾国がありません`);
setStatus(`討伐回復：傾国 ${n+1}/3 ${card.name}`,'work');
await activateRecoverySkill(card,card.keikoku,villageId);
await sleep(recoveryWaitMs('bro3-tp-skill-gap',DEFAULT_SKILL_GAP));
if(stopRequested)return false;
}
return true;
}
function extractOwnedTp(html){
const doc=toDoc(html);
const candidates=[];
const clean=value=>String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim();
const amount=/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;
const label=/^(?:所持\s*TP|TP\s*所持|現在(?:の)?\s*TP|トレードポイント|Trade Points|TP)\s*[:：]?\s*/i;
const add=(value,source)=>{
const raw=clean(value);
if(!amount.test(raw))return false;
const n=Number(raw.replace(/,/g,''));
if(!Number.isFinite(n)||n<0||n>Number.MAX_SAFE_INTEGER)return false;
candidates.push({n,source});
return true;
};
const readNear=(el,source)=>{
let scope=el;
for(let depth=0;scope&&depth<=2;depth++,scope=scope.parentElement){
const raw=clean(scope.textContent);
if(raw&&add(raw.replace(label,''),source))return;
if(!raw||label.test(raw)&&!raw.replace(label,'')){
const next=scope.nextElementSibling;
if(next&&add(clean(next.textContent),source+' 隣接値'))return;
}
}
};
const readAfterImage=img=>{
let value='';
for(let node=img.nextSibling;node;node=node.nextSibling){
if(node.nodeType===3){
value+=node.textContent||'';
}else if(node.nodeType===1){
if(node.tagName==='IMG'||node.querySelector('img'))break;
const text=clean(node.textContent);
if(text&&!amount.test(text))break;
value+=node.textContent||'';
}
}
return add(value,'TP画像直後');
};
for(const img of doc.querySelectorAll('#status_right img, #bptpcp_area img, img[alt], img[title]')){
const alt=clean(img.getAttribute('alt'));
const title=clean(img.getAttribute('title'));
const src=img.getAttribute('src')||'';
const isTp=/^(?:TP|トレードポイント|Trade Points)$/i.test(alt)||
/^(?:TP|トレードポイント|Trade Points)$/i.test(title)||
/(?:^|[/_-])(?:icon[_-])?tp(?:[_-]\d+)?\.(?:gif|png|jpe?g|webp)(?:[?#]|$)/i.test(src);
if(isTp&&!readAfterImage(img))readNear(img,'TP画像 '+(title||alt||src));
}
for(const el of doc.querySelectorAll('dt,dd,th,td,span,div,li,p,strong,b')){
if(el.children.length>5)continue;
const raw=clean(el.textContent);
if(!raw||raw.length>100||!label.test(raw))continue;
const value=raw.replace(label,'');
if(value)add(value,raw);
else readNear(el,'TPラベル '+raw);
}
const uniq=[...new Set(candidates.map(v=>v.n))];
if(uniq.length===1)return uniq[0];
throw new Error(`所持TPの取得${uniq.length ? '値が複数あり不一致' : 'に失敗'}。出兵を停止（Consoleに取得候補を記録）`);
}
async function readOwnedTp(){
return extractOwnedTp(await getHTML('/village.php'));
}
async function startAutoRun(){
if(autoRunning)return;
testStart();
const mainX=Number(document.getElementById('bro3-tp-main-x').value),mainY=Number(document.getElementById('bro3-tp-main-y').value);
const subX=Number(document.getElementById('bro3-tp-sub-x').value),subY=Number(document.getElementById('bro3-tp-sub-y').value);
const selected=getSelectedCardIds();
const labelId=document.getElementById('bro3-tp-heal-label').value;
const firstWait=Number(document.getElementById('bro3-tp-first-wait').value);
const recheckWait=Number(document.getElementById('bro3-tp-recheck-wait').value);
if(![mainX,mainY,subX,subY].every(Number.isFinite)||!selected.length||!labelId||
!Number.isFinite(firstWait)||firstWait<1||!Number.isFinite(recheckWait)||recheckWait<1)return;
excludedRecoveryCards.clear();
stopRequested=false;autoRunning=true;cycleCount=0;
document.getElementById('bro3-tp-start').disabled=true;
try{
while(autoRunning&&!stopRequested){
cycleCount++;
setStatus(`第${cycleCount}巡：討伐ゲージ500を確認中`,'work');
if(!await waitUntilSubdue500(selected,recheckWait,labelId))break;
setStatus(`第${cycleCount}巡：討伐500確認済み・出兵元を確認中`,'work');
const villageMap=await getWaitingCardVillageMap();
const missing=selected.filter(id=>!villageMap.has(id));
if(missing.length)throw new Error(`待機中として確認できない選択武将があります：${missing.join(', ')}`);
setStatus(`第${cycleCount}巡：出兵前の所持TP取得中`,'work');
const tpBefore=await readOwnedTp();
const succeeded=[];
for(let i=0;i<selected.length;i++){
if(stopRequested)break;
const id=selected[i];
const prog=document.getElementById('bro3-tp-progress');
if(prog)prog.textContent=`${i} / ${selected.length}`;
setStatus(`第${cycleCount}巡：鹵獲出兵 ${i+1}/${selected.length} ID:${id}`,'work');
const origin=villageMap.get(id);const tx=origin.deckType==='main'?mainX:subX,ty=origin.deckType==='main'?mainY:subY;
setStatus(`第${cycleCount}巡：${origin.deckType==='main'?'本拠':'拠点'} → (${tx},${ty}) ${i+1}/${selected.length}`,'work');
const r=await sendCapture(id,origin.villageId,tx,ty);
if(r.limit){
autoRunning=false;
setStatus(`正常終了：${r.message}`,'ok');
return;
}
if(!r.ok)throw new Error(`ID:${id} 出兵失敗：${r.message}`);
succeeded.push(id);
if(prog)prog.textContent=`${i+1} / ${selected.length}`;
await sleep(250);
}
if(stopRequested||!succeeded.length)break;
setStatus(`第${cycleCount}巡：帰還待ち（初回${firstWait}秒）`,'work');
if(!await waitInterruptible(firstWait))break;
while(autoRunning&&!stopRequested){
setStatus(`第${cycleCount}巡：${succeeded.length}体の帰還確認中`,'work');
if(await allSortiedCardsReturned(succeeded))break;
setStatus(`第${cycleCount}巡：未帰還あり。${recheckWait}秒後に再確認`,'work');
if(!await waitInterruptible(recheckWait))break;
}
if(stopRequested||!autoRunning)break;
setStatus(`第${cycleCount}巡：帰還完了・所持TPを照合中`,'work');
const tpAfter=await readOwnedTp();
if(tpAfter<=tpBefore){
throw new Error(`TP増加なし（出兵前${tpBefore} → 帰還後${tpAfter}）。自動停止`);
}
setStatus(`第${cycleCount}巡：TP +${tpAfter-tpBefore} 確認。回復開始`,'ok');
if(!await performRecovery(labelId,succeeded))break;
setStatus(`第${cycleCount}巡：回復完了。次の出兵へ`,'ok');
await sleep(500);
}
}catch(e){
console.error('[自動TP] 自動運転停止',e);
autoRunning=false;
setStatus(`停止：${e.message}`,'error');
}finally{
autoRunning=false;
document.getElementById('bro3-tp-start').disabled=false;
if(stopRequested)setStatus('停止しました');
}
}
function testStart(){
const mainX=Number(document.getElementById('bro3-tp-main-x').value),mainY=Number(document.getElementById('bro3-tp-main-y').value);
const subX=Number(document.getElementById('bro3-tp-sub-x').value),subY=Number(document.getElementById('bro3-tp-sub-y').value);
const cards=[...document.querySelectorAll('.bro3-tp-card-check:checked')];
const labelSelect=document.getElementById('bro3-tp-heal-label');
const labelId=labelSelect.value;
const labelName=labelSelect.options[labelSelect.selectedIndex]?.textContent||'';
const firstWait=Number(document.getElementById('bro3-tp-first-wait').value);
const recheckWait=Number(document.getElementById('bro3-tp-recheck-wait').value);
if(![mainX,mainY,subX,subY].every(Number.isFinite)){
setStatus('座標が正しくありません','error');
return;
}
if(!cards.length){
setStatus('出兵武将が選択されていません','error');
return;
}
if(!labelId){
setStatus('回復ラベルが選択されていません','error');
return;
}
if(!Number.isFinite(firstWait)||firstWait<1||!Number.isFinite(recheckWait)||recheckWait<1){
setStatus('帰還確認秒数が正しくありません','error');
return;
}
saveSelectedCards();
localStorage.setItem(KEY.MAIN_X,mainX);localStorage.setItem(KEY.MAIN_Y,mainY);localStorage.setItem(KEY.SUB_X,subX);localStorage.setItem(KEY.SUB_Y,subY);
localStorage.setItem(KEY.LABEL,labelId);
localStorage.setItem(KEY.FIRST_WAIT,firstWait);
localStorage.setItem(KEY.RECHECK_WAIT,recheckWait);
if(!AUTO_OPERATION_ENABLED){
setStatus(
`準備OK：${cards.length}体 / 本拠(${mainX},${mainY}) / 拠点(${subX},${subY}) / 初回${firstWait}秒 / 再確認${recheckWait}秒 / 回復:${labelName}`,
'ok'
);
}
}
async function init(){
addStyle();
createPanel();
setStatus('情報取得中','work');
try{await loadBookmarksUI();}
catch(e){console.error('[自動TP] 出兵先取得',e);setStatus(`出兵先取得エラー：${e.message}`,'error');}
await sleep(150);
try{await loadLabelsUI();}
catch(e){console.error('[自動TP] ラベル取得',e);setStatus(`ラベル取得エラー：${e.message}`,'error');}
await sleep(150);
try{await loadCardsUI();}
catch(e){console.error('[自動TP] 武将取得',e);setStatus(`武将取得エラー：${e.message}`,'error');}
if(document.querySelectorAll('.bro3-tp-card-check').length)setStatus('停止中・設定してください');
}
if(!startSubdueProbe()){
if(location.pathname==='/card/deck.php')return;
init();
}
})();
