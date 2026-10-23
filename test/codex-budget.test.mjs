import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, writeFileSync, copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, runCli, runHook } from './helpers.mjs';

test('Codex official RPC initializes, reads only account limits, and uses weekly primary thresholds', () => {
  const { dir } = tempRepo();
  const fake = join(dir, 'codex');
  writeFileSync(fake, `#!/usr/bin/env node
const readline = require('node:readline');
readline.createInterface({input:process.stdin}).on('line', line => {
 const m=JSON.parse(line);
 if(m.method==='initialize') process.stdout.write(JSON.stringify({id:m.id,result:{userAgent:'fake'}})+'\\n');
 else if(m.method==='account/rateLimits/read') process.stdout.write(JSON.stringify({id:m.id,result:{rateLimits:{planType:'plus',primary:{usedPercent:10,windowDurationMins:300}},rateLimitsByLimitId:{codex:{planType:'pro',primary:{usedPercent:90,windowDurationMins:10080,resetsAt:Math.floor(Date.now()/1000)+3600}}}}})+'\\n');
 else if(m.method!=='initialized') process.exit(4);
});
`);
  chmodSync(fake, 0o755);
  const res = runCli(['budget', '--harness', 'codex', '--json'], { cwd: dir, env: { RELAY_HOME: join(dir,'home'), CODEX_HOME: join(dir,'codex-home'), RELAY_CODEX_BIN: fake } });
  assert.equal(res.code, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.harness, 'codex');
  assert.equal(out.level, 'tight');
  assert.equal(out.snapshot.windows[0].windowMinutes, 10080);
  assert.equal(out.snapshot.planType, 'pro');
  assert.equal(out.snapshot.fiveHour, undefined);
});

test('Codex never uses Claude snapshot and missing executable fails open to unknown', () => {
  const {dir} = tempRepo(); const home=join(dir,'home'); mkdirSync(home);
  writeFileSync(join(home,'budget.json'),JSON.stringify({updatedAt:new Date().toISOString(),fiveHour:{percentUsed:99}}));
  const res=runCli(['budget','--harness','codex','--json'],{cwd:dir,env:{RELAY_HOME:home,CODEX_HOME:join(dir,'empty'),RELAY_CODEX_BIN:join(dir,'missing')}});
  assert.equal(res.code,0,res.stderr); assert.equal(JSON.parse(res.stdout).level,'unknown');
});

test('Codex spawn preserves arguments, caps effort/model, denies implementations, and fails open on malformed input', () => {
  const {dir} = tempRepo(); const home=join(dir,'home'); mkdirSync(join(home,'codex'),{recursive:true});
  const path=join(home,'codex','budget.json');
  const snap=(pct)=>writeFileSync(path,JSON.stringify({updatedAt:new Date().toISOString(),windows:[{id:'primary',usedPercent:pct,windowMinutes:300}]}));
  snap(70);
  const input={tool_name:'spawn_agent',tool_input:{agent_type:'relay-reviewer',model:'gpt-6-astra',reasoning_effort:'high',message:'Review this',fork_turns:'none'}};
  const res=runHook('codex-spawn.mjs',input,{RELAY_HOME:home,CODEX_HOME:join(dir,'empty')});
  assert.equal(res.code,0,res.stderr);
  assert.deepEqual(JSON.parse(res.stdout).hookSpecificOutput,{hookEventName:'PreToolUse',permissionDecision:'allow',updatedInput:{...input.tool_input,model:'gpt-6.1-sol',reasoning_effort:'medium'}});
  snap(96);
  const denied=runHook('codex-spawn.mjs',{tool_name:'Agent',tool_input:{agent_type:'relay-implementer',message:'Build'}},{RELAY_HOME:home,CODEX_HOME:join(dir,'empty')});
  assert.equal(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision,'deny');
  assert.match(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecisionReason,/budget is critical/);
  assert.equal(runHook('codex-spawn.mjs',{tool_name:'spawn_agent',tool_input:null},{RELAY_HOME:home}).stdout,'');
  assert.equal(runHook('codex-spawn.mjs',{tool_name:'Bash',tool_input:{command:'true'}},{RELAY_HOME:home}).stdout,'');
});

test('Codex forecast and calibration use separate stores and time samples without private credits', () => {
  const {dir}=tempRepo(); const plan=join(dir,'plan.md');
  copyFileSync(new URL('./fixtures/plan-basic.md',import.meta.url),plan);
  const home=join(dir,'home'); const env={RELAY_HOME:home,RELAY_HARNESS:'claude',CODEX_HOME:join(dir,'empty'),RELAY_CODEX_BIN:join(dir,'missing')};
  const f=runCli(['forecast',plan,'--harness','codex','--json'],{cwd:dir,env});
  assert.equal(f.code,0,f.stderr); const out=JSON.parse(f.stdout);
  assert.equal(out.harness,'codex'); assert.deepEqual(out.usage.map(w=>w.windowMinutes),[300,10080]);
  const led=runCli(['ledger',plan,'start: run','--harness','codex'],{cwd:dir,env}); assert.equal(led.code,0,led.stderr);
  writeFileSync(join(dir,'.relay','runs',out.slug,'ledger.md'),'- 2026-10-23 10:00 [primary 10% resets 14:00] start: run\n- 2026-10-23 10:30 [primary 15% resets 14:00] wave 1: merged @ abc\n');
  const measured=runCli(['calibrate',plan,'--harness','codex'],{cwd:dir,env});
  assert.equal(measured.code,0,measured.stderr);
  const saved=JSON.parse(readFileSync(join(home,'codex','calibration.json'),'utf8'));
  assert.equal(saved.samples[0].v,'codex-1'); assert.equal(saved.samples.find(sample => sample.kind === 'wave').wallMinutes,30);
  const calibrated=runCli(['forecast',plan,'--harness','codex','--json'],{cwd:dir,env});
  assert.equal(JSON.parse(calibrated.stdout).calibrated.time,true);
  const cal=runCli(['calibrate','--show','--harness','codex'],{cwd:dir,env});
  assert.equal(cal.code,0,cal.stderr); assert.match(cal.stdout,/codex\/calibration.json/);
});


test('Codex RPC timeout kills a child ignoring TERM and invalid percentages stay unknown', () => {
  const {dir}=tempRepo(); const fake=join(dir,'codex'); const home=join(dir,'home');
  writeFileSync(fake,`#!/usr/bin/env node
process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`); chmodSync(fake,0o755);
  const before=Date.now();
  const res=runCli(['budget','--harness','codex','--json'],{cwd:dir,env:{RELAY_HOME:home,CODEX_HOME:join(dir,'empty'),RELAY_CODEX_BIN:fake}});
  assert.equal(res.code,0,res.stderr); assert.equal(JSON.parse(res.stdout).level,'unknown'); assert.ok(Date.now()-before<6000);
  mkdirSync(join(home,'codex'),{recursive:true});
  writeFileSync(join(home,'codex','budget.json'),JSON.stringify({updatedAt:new Date().toISOString(),windows:[{id:'primary',usedPercent:'bad',windowMinutes:300}]}));
  const invalid=runCli(['budget','--harness','codex','--json'],{cwd:dir,env:{RELAY_HOME:home,CODEX_HOME:join(dir,'empty'),RELAY_CODEX_BIN:join(dir,'missing')}});
  assert.equal(JSON.parse(invalid.stdout).level,'unknown');
});

test('normal weekly-only Codex ledger calibrates usage without claiming measured credits', () => {
  const {dir} = tempRepo();
  const plan = join(dir, 'plan.md');
  copyFileSync(new URL('./fixtures/plan-basic.md', import.meta.url), plan);
  const home = join(dir, 'home');
  mkdirSync(join(home, 'codex'), {recursive:true});
  writeFileSync(join(home, 'codex', 'budget.json'), JSON.stringify({
    updatedAt:new Date().toISOString(), planType:'pro',
    windows:[{id:'primary',usedPercent:20,windowMinutes:10080,resetsAt:new Date(Date.now()+86400000).toISOString()}],
  }));
  const state = join(dir, 'limits.json');
  const fake = join(dir, 'codex');
  writeFileSync(fake, `#!/usr/bin/env node
const readline = require('node:readline');
const fs = require('node:fs');
readline.createInterface({input:process.stdin}).on('line', line => {
 const message = JSON.parse(line);
 if (message.method === 'initialize') process.stdout.write(JSON.stringify({id:message.id,result:{userAgent:'fake'}})+'\\n');
 else if (message.method === 'account/rateLimits/read') process.stdout.write(JSON.stringify({id:message.id,result:{rateLimits:JSON.parse(fs.readFileSync(process.env.TEST_LIMITS_FILE,'utf8'))}})+'\\n');
});
`);
  chmodSync(fake,0o755);
  const update = pct => writeFileSync(state,JSON.stringify({planType:'pro',primary:{usedPercent:pct,windowDurationMins:10080,resetsAt:Math.floor(Date.now()/1000/86400)*86400+5*86400}}));
  const env = {RELAY_HOME:home,CODEX_HOME:join(dir,'empty'),RELAY_CODEX_BIN:fake,TEST_LIMITS_FILE:state};
  update(5);
  const initial = runCli(['budget','--harness','codex','--json'],{cwd:dir,env});
  assert.equal(JSON.parse(initial.stdout).snapshot.windows[0].usedPercent,5);
  const before = JSON.parse(runCli(['forecast',plan,'--harness','codex','--json'],{cwd:dir,env}).stdout);
  update(10);
  const start = runCli(['ledger',plan,'start: run','--harness','codex'],{cwd:dir,env});
  assert.equal(start.code,0,start.stderr);
  update(30);
  const merge = runCli(['ledger',plan,'wave 1: merged @ abc','--harness','codex'],{cwd:dir,env});
  assert.equal(merge.code,0,merge.stderr);
  const ledger = readFileSync(join(dir,'.relay','runs',before.slug,'ledger.md'),'utf8');
  assert.match(ledger,/primary 10%.*start: run/);
  assert.match(ledger,/primary 30%.*wave 1: merged/);
  const cal = runCli(['calibrate',plan,'--harness','codex'],{cwd:dir,env});
  assert.equal(cal.code,0,cal.stderr);
  const after = JSON.parse(runCli(['forecast',plan,'--harness','codex','--json'],{cwd:dir,env}).stdout);
  assert.notEqual(after.usage[0].pct,before.usage[0].pct);
  assert.equal(after.usage[0].windowMinutes,10080);
  assert.equal(after.usage[0].measuredUsage,true);
  assert.equal(after.usage[0].capacityBasis,'measured usage; credit and tier mix priors');
  assert.equal(after.calibrated.credits,false);
  assert.equal(after.calibrated.capacity,false);
  const samples = JSON.parse(readFileSync(join(home,'codex','calibration.json'),'utf8')).samples;
  assert.equal(samples.find(sample => sample.kind === 'usage').dU,20);
  assert.equal(samples.find(sample => sample.kind === 'usage').windowMinutes,10080);
  const failed = runCli(['ledger',plan,'note: refresh unavailable','--harness','codex','--codex-bin',join(dir,'missing')],{cwd:dir,env});
  assert.equal(failed.code,0,failed.stderr);
  assert.match(failed.stderr,/usage stamp omitted/);
  const finalLine = readFileSync(join(dir,'.relay','runs',before.slug,'ledger.md'),'utf8').trim().split('\n').at(-1);
  assert.match(finalLine,/note: refresh unavailable$/);
  assert.doesNotMatch(finalLine,/\[/);
});

test('Relay routing denies full-history overrides and leaves unrelated full-history spawns intact', () => {
  const {dir} = tempRepo();
  const env = {RELAY_HOME:join(dir,'home'),CODEX_HOME:join(dir,'empty')};
  const full = runHook('codex-spawn.mjs', {
    tool_name:'spawn_agent', tool_input:{agent_type:'relay-reviewer',message:'Review',fork_turns:'all'},
  },env);
  const decision = JSON.parse(full.stdout).hookSpecificOutput;
  assert.equal(decision.permissionDecision,'deny');
  assert.match(decision.permissionDecisionReason,/fork_turns.*none/);
  assert.equal(decision.updatedInput,undefined);
  const inherited = runHook('codex-spawn.mjs', {
    tool_name:'spawn_agent', tool_input:{agent_type:'relay-reviewer',message:'Review'},
  },env);
  assert.equal(JSON.parse(inherited.stdout).hookSpecificOutput.permissionDecision,'deny');
  const unrelated = runHook('codex-spawn.mjs', {
    tool_name:'spawn_agent', tool_input:{agent_type:'another-plugin',message:'Explore',fork_turns:'all'},
  },env);
  assert.equal(unrelated.code,0,unrelated.stderr);
  assert.equal(unrelated.stdout,'');
});

test('weekly reset date survives a wave crossing its clock time several days early', async () => {
  const {formatStamp,parseLedgerLine} = await import('../codex-math/lib/calibration.mjs');
  const {codexWaveSamples} = await import('../lib/codex-integration.mjs');
  const {planLanes} = await import('../scripts/relay-lanes.mjs');
  const {dir} = tempRepo(); const plan = join(dir,'plan.md');
  copyFileSync(new URL('./fixtures/plan-basic.md',import.meta.url),plan);
  const parsed = planLanes(plan);
  const reset = '2026-10-26T14:00:00.000Z';
  const stamp = pct => formatStamp({windows:[{id:'primary',usedPercent:pct,resetsAt:reset}]});
  const text = `- 2026-10-23 13:30${stamp(10)} start: run\n- 2026-10-23 14:30${stamp(30)} wave 1: merged @ abc\n`;
  assert.equal(parseLedgerLine(text.split('\n')[0]).windows.primary.resetsAt,Date.parse(reset));
  const samples = codexWaveSamples(text,parsed.lanes,parsed.plan.slug,Object.fromEntries(parsed.plan.tasks.map(task=>[task.id,task]))).samples;
  assert.equal(samples.find(sample=>sample.kind==='usage').dU,20);
  assert.equal(samples.find(sample=>sample.kind==='wave').wallMinutes,60);
});
