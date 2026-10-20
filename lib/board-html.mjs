// The board as one self-contained HTML page: a roadmap of waves and lanes with a
// traffic light on every task. No network, no dependencies; it reloads itself
// while the run is going so it can stay open in a browser tab.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function renderBoardHtml(board) {
  const data = JSON.stringify(board).replace(/</g, '\\u003c');
  const title = `${board.slug} · relay board`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{color-scheme:light;--bg:#f7f7f5;--card:#ffffff;--line:#e4e3de;--ink:#161614;--ink2:#55544f;--muted:#8a8984;
--grey:#a3a29c;--yellow:#d99a00;--green:#1a9e5c;--red:#d93f3e;--grey-bg:#f0efeb;--yellow-bg:#fdf3dc;--green-bg:#e3f5ec;--red-bg:#fbe6e5;--focus:#2a78d6}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#151514;--card:#1e1e1c;--line:#2f2f2c;--ink:#f0efec;--ink2:#c3c2b7;--muted:#8f8e86;
--grey:#77766f;--yellow:#e8ac1c;--green:#34b673;--red:#ec5f5e;--grey-bg:#262624;--yellow-bg:#352b12;--green-bg:#14301f;--red-bg:#3a1a1a;--focus:#5598e7}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif}
header{padding:20px 24px 12px;border-bottom:1px solid var(--line);background:var(--card)}
h1{font-size:18px;margin:0 0 2px;font-weight:650;letter-spacing:-.01em}
.goal{color:var(--ink2);margin:0 0 12px}
.row{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center}
.pill{display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid var(--line)}
.bar{flex:1 1 260px;height:10px;border-radius:6px;background:var(--grey-bg);overflow:hidden;display:flex;min-width:180px}
.bar span{display:block;height:100%}
.meta{color:var(--muted);font-size:12px}
.legend{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--ink2)}
.filters{display:flex;gap:6px;flex-wrap:wrap}
.filters button{font:inherit;font-size:12px;padding:3px 10px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--ink2);cursor:pointer}
.filters button[aria-pressed=true]{background:var(--ink);color:var(--card);border-color:var(--ink)}
main{padding:16px 24px 32px;display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:20px}
@media (max-width:900px){main{grid-template-columns:1fr;padding:12px 16px}header{padding:16px}}
.waves{display:flex;gap:14px;overflow-x:auto;padding-bottom:6px;align-items:flex-start}
.wave{flex:0 0 290px;min-width:0}
.wave h2{font-size:13px;margin:0 0 8px;display:flex;align-items:center;gap:8px;color:var(--ink2);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.lane{background:var(--card);border:1px solid var(--line);border-radius:10px;margin-bottom:10px;overflow:hidden}
.lane-h{display:flex;gap:8px;align-items:flex-start;padding:9px 11px;border-bottom:1px solid var(--line)}
.lane-h b{font-size:13px}
.note{color:var(--muted);font-size:12px;margin-top:1px;word-break:break-word}
.task{display:flex;gap:9px;align-items:flex-start;width:100%;padding:8px 11px;border:0;border-top:1px solid var(--line);background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.task:first-of-type{border-top:0}
.task:hover{background:var(--grey-bg)}
.task:focus-visible,.filters button:focus-visible{outline:2px solid var(--focus);outline-offset:-2px}
.task[aria-current=true]{background:var(--grey-bg)}
.t-title{flex:1;min-width:0}
.t-title small{display:block;color:var(--muted);font-size:11.5px}
.light{flex:0 0 auto;width:18px;height:18px;border-radius:50%;display:inline-grid;place-items:center;font-size:11px;font-weight:700;color:#fff}
.light.grey{background:var(--grey)}.light.queued{background:transparent;border:2px solid var(--grey);color:var(--grey)}.light.yellow{background:var(--yellow)}.light.green{background:var(--green)}.light.red{background:var(--red)}
.chip{font-size:11px;padding:0 6px;border-radius:4px;background:var(--grey-bg);color:var(--ink2);white-space:nowrap}
.chip.wrap{white-space:normal;display:inline}
.lane-h>div{min-width:0}
.t-title{overflow-wrap:anywhere}
aside{position:sticky;top:12px;align-self:start;display:flex;flex-direction:column;gap:14px}
.panel{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.panel h3{margin:0 0 8px;font-size:13px}
.panel ul{margin:0;padding-left:18px}
.panel li{margin:3px 0;word-break:break-word}
code{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--grey-bg);padding:1px 4px;border-radius:4px;word-break:break-all}
.empty{color:var(--muted)}
.hidden{display:none!important}
@media (max-width:700px){.waves{flex-direction:column;overflow-x:visible;align-items:stretch}.wave{flex:none;width:100%}aside{position:static}}
</style>
</head>
<body>
<header>
  <h1 id="title"></h1>
  <p class="goal" id="goal"></p>
  <div class="row" style="margin-bottom:10px">
    <span class="pill" id="status"></span>
    <div class="bar" id="bar" role="img"></div>
    <span id="count" style="font-weight:600"></span>
  </div>
  <div class="row">
    <div class="legend" id="legend"></div>
    <div class="filters" id="filters" role="group" aria-label="Show tasks"></div>
    <span class="meta" id="meta"></span>
  </div>
</header>
<main>
  <section class="waves" id="waves" aria-label="Roadmap"></section>
  <aside>
    <div class="panel" id="detail" aria-live="polite"><h3>Task</h3><p class="empty">Select a task to see its files, behaviors, test budget and done check.</p></div>
    <div class="panel"><h3>Rulings</h3><ul id="rulings"></ul></div>
    <div class="panel"><h3>Latest ledger lines</h3><ul id="tail"></ul></div>
  </aside>
</main>
<script id="data" type="application/json">${data}</script>
<script>
(function(){
var B=JSON.parse(document.getElementById('data').textContent);
var GLYPH={planned:'',queued:'·',working:'◐',done:'✓',merged:'✓',blocked:'✕'};
var LABEL={planned:'planned',queued:'queued in its lane',working:'in progress',done:'done, not merged yet',merged:'merged',blocked:'blocked'};
var FILTERS=[['all','All'],['working','In progress'],['blocked','Blocked'],['green','Done'],['planned','Planned']];
function el(tag,attrs,kids){var e=document.createElement(tag);for(var k in attrs||{}){if(k==='text')e.textContent=attrs[k];else if(k==='cls')e.className=attrs[k];else e.setAttribute(k,attrs[k]);}(kids||[]).forEach(function(c){if(c)e.appendChild(typeof c==='string'?document.createTextNode(c):c)});return e}
function light(state,light){return el('span',{cls:'light '+(state==='queued'?'queued':light),'aria-hidden':'true',text:GLYPH[state]})}
var filter=(location.hash.match(/f=(\\w+)/)||[])[1]||'all';
var current=(location.hash.match(/t=([^&]+)/)||[])[1];
function setHash(){var h=[];if(filter!=='all')h.push('f='+filter);if(current)h.push('t='+current);history.replaceState(null,'',h.length?'#'+h.join('&'):location.pathname)}
document.getElementById('title').textContent=(B.goal&&B.goal!==B.slug?B.slug+' — ':'')+(B.goal||B.slug);
document.getElementById('goal').textContent=B.planRel||B.plan||'';
var st={complete:['green','Complete'],blocked:['red','Blocked'],running:['yellow','Running · wave '+B.currentWave+' of '+B.waveCount],planned:['grey','Not started']}[B.status];
var sp=document.getElementById('status');sp.appendChild(light(B.status==='complete'?'merged':B.status==='running'?'working':B.status,st[0]));sp.appendChild(document.createTextNode(st[1]));
var T=B.totals,bar=document.getElementById('bar');
[['green',T.done+T.merged],['yellow',T.working],['red',T.blocked]].forEach(function(p){if(p[1])bar.appendChild(el('span',{style:'width:'+(100*p[1]/T.tasks)+'%;background:var(--'+p[0]+')'}))});
bar.setAttribute('aria-label',(T.done+T.merged)+' of '+T.tasks+' tasks done, '+T.working+' in progress, '+T.blocked+' blocked');
document.getElementById('count').textContent=(T.done+T.merged)+' / '+T.tasks+' tasks green';
var lg=document.getElementById('legend');[['planned','grey',T.planned],['working','yellow',T.working],['merged','green',T.done+T.merged],['blocked','red',T.blocked]].forEach(function(x){lg.appendChild(el('span',{},[light(x[0],x[1]),' '+(x[0]==='merged'?'done':LABEL[x[0]])+' '+x[2]]))});
var meta=['updated '+new Date(B.updatedAt).toLocaleTimeString()];
if(B.budget)meta.push('budget '+B.budget.level+' · 5h '+B.budget.fiveHour+'%');
if(B.marathon&&!B.marathon.endedAt&&B.marathon.phase)meta.push('marathon: '+(B.marathon.phase.kind==='waiting'?'waiting for the window reset':'leg '+B.marathon.phase.leg));
document.getElementById('meta').textContent=meta.join(' · ');
var fb=document.getElementById('filters');
FILTERS.forEach(function(f){var b=el('button',{type:'button','aria-pressed':String(filter===f[0]),text:f[1]});b.onclick=function(){filter=f[0];setHash();render()};fb.appendChild(b)});
function match(t){return filter==='all'||(filter==='green'?(t.state==='done'||t.state==='merged'):filter==='planned'?(t.state==='planned'||t.state==='queued'):t.state===filter)}
function detail(t,l){var d=document.getElementById('detail');d.innerHTML='';
d.appendChild(el('h3',{},[light(t.state,t.light),' '+t.id+' · '+t.title]));
d.appendChild(el('p',{},[LABEL[t.state]+' · lane '+l.id+' · wave '+l.wave]));
d.appendChild(el('p',{},[el('span',{cls:'chip',text:t.tier}),' ',el('span',{cls:'chip',text:t.risk+' risk'}),' ',el('span',{cls:'chip',text:t.tests+' new test'+(t.tests===1?'':'s')})]));
if(t.behaviors.length){d.appendChild(el('b',{text:'Behaviors'}));d.appendChild(el('ul',{},t.behaviors.map(function(x){return el('li',{text:x})})))}
d.appendChild(el('b',{text:'Files'}));d.appendChild(el('ul',{},t.files.map(function(x){return el('li',{},[el('code',{text:x})])})));
if(t.done){d.appendChild(el('b',{text:'Done when'}));d.appendChild(el('p',{},[el('code',{text:t.done})]))}
d.appendChild(el('p',{cls:'note',text:'Lane '+l.id+': '+l.note}))}
function render(){Array.prototype.forEach.call(fb.children,function(b,i){b.setAttribute('aria-pressed',String(FILTERS[i][0]===filter))});
var root=document.getElementById('waves');root.innerHTML='';var found=null;
B.waves.forEach(function(w){var col=el('div',{cls:'wave'});col.appendChild(el('h2',{},[light(w.state,w.light),'Wave '+w.wave+' · '+LABEL[w.state]]));var any=false;
w.lanes.forEach(function(l){var tasks=l.tasks.filter(match);if(!tasks.length)return;any=true;
var card=el('div',{cls:'lane'});card.appendChild(el('div',{cls:'lane-h'},[light(l.state,l.light),el('div',{},[el('b',{text:'Lane '+l.id}),' ',el('span',{cls:'chip wrap',text:l.agents.filter(function(a,i,x){return i===0||a!==x[i-1]}).join(' → ')}),el('div',{cls:'note',text:l.note})])]));
tasks.forEach(function(t){var b=el('button',{cls:'task',type:'button','aria-label':t.id+' '+t.title+', '+LABEL[t.state]},[light(t.state,t.light),el('span',{cls:'t-title'},[t.id+' · '+t.title,el('small',{text:LABEL[t.state]+' · '+t.tier+' · '+t.risk+' risk'})])]);
if(current===t.id){b.setAttribute('aria-current','true');found=[t,l]}
b.onclick=function(){current=t.id;setHash();render();if(window.innerWidth<900)document.getElementById('detail').scrollIntoView({behavior:'smooth',block:'start'})};card.appendChild(b)});col.appendChild(card)});
if(!any)col.appendChild(el('p',{cls:'empty',text:'Nothing here for this filter.'}));root.appendChild(col)});
if(found)detail(found[0],found[1])}
render();
var ru=document.getElementById('rulings');if(!B.rulings.length)ru.appendChild(el('li',{cls:'empty',text:'none yet'}));B.rulings.forEach(function(r){ru.appendChild(el('li',{text:r}))});
var tl=document.getElementById('tail');if(!B.ledgerTail.length)tl.appendChild(el('li',{cls:'empty',text:'the run has not started'}));B.ledgerTail.forEach(function(r){tl.appendChild(el('li',{text:r}))});
${board.status === 'running' || board.status === 'blocked' ? 'setTimeout(function(){location.reload()},15000);\n' : ''}})();
</script>
</body>
</html>
`;
}
