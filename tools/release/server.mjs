import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'

function html(token) {
  return String.raw`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>OhMyLife 发布审核</title>
<style nonce="${token}">
*{box-sizing:border-box}body{margin:0;background:#f4f5f7;color:#20232a;font:15px/1.6 system-ui}
.layout{display:grid;grid-template-columns:680px 280px;gap:24px;width:984px;margin:40px auto;align-items:start}
main,aside{padding:28px;background:white;border-radius:12px}h1{margin:0 0 24px;font-size:24px}h2{margin:24px 0 12px;font-size:17px}aside h2{margin-top:0}
dl{display:grid;grid-template-columns:88px 1fr;gap:10px 20px;margin:0}dt{color:#626773}dd{margin:0}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}aside pre,#progress{padding:12px;background:#f4f5f7;border-radius:8px}aside pre{font:13px/1.6 monospace}
button{padding:10px 18px;border:1px solid #d4d7dc;border-radius:8px;background:white;cursor:pointer;font:inherit}button.primary{background:#176c46;color:white;border-color:#176c46}button:disabled{opacity:.45;cursor:default}
.actions{display:flex;gap:12px;justify-content:flex-end;margin-top:24px}.notice{margin-top:24px;padding:12px;background:#fff5db;border-radius:8px}input{margin-right:8px}
#result{white-space:pre-wrap;overflow-wrap:anywhere}#result:empty,#link:empty{display:none}a{color:#176c46}
</style>
<div class="layout"><main>
<h1>OhMyLife 发布审核</h1>
<dl><dt>版本</dt><dd id="version"></dd><dt>仓库</dt><dd id="repository"></dd><dt>目标分支</dt><dd>main</dd><dt>安装包</dt><dd id="apk"></dd><dt>大小</dt><dd id="size"></dd></dl>
<h2>发布说明</h2><pre id="notes"></pre>
<div id="tagWarning" class="notice" hidden><label><input type="checkbox" id="ack"><span id="tagText"></span></label></div>
<p id="result" role="status"></p><pre id="progress" hidden></pre><p id="link"></p>
<div class="actions"><button id="cancel">取消</button><button class="primary" id="confirm" disabled>确认发布</button></div>
</main><aside><h2>GitHub CLI</h2><p id="auth" role="status">检查中…</p><pre id="login" hidden>gh auth login --web</pre><button id="refresh">重新检查</button></aside></div>
<script nonce="${token}">
const token=${JSON.stringify(token)};
const $=id=>document.getElementById(id);
let state,auth,busy=false;
async function api(path,body){
  const response=await fetch(path,{method:body?'POST':'GET',headers:{'X-Review-Token':token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const value=await response.json();if(!response.ok)throw Error(value.error);return value;
}
function buttonState(){$('confirm').disabled=busy||!state||!auth?.ready||!!state.blocked||(state.replaceTag&&!$('ack').checked)}
async function load(){
  try{
    state=await api('/state');const a=state.approved;
    $('version').textContent=a.tag;$('repository').textContent=state.repository;$('apk').textContent=a.apk.file;$('size').textContent=(a.apk.bytes/1024**2).toFixed(1)+' MB';$('notes').textContent=a.notes;
    $('tagWarning').hidden=!state.replaceTag||!!state.blocked;$('tagText').textContent='将未发布的 '+a.tag+' 标签指向本次源码';$('result').textContent=state.blocked||'';buttonState();
  }catch(error){$('result').textContent=error.message}
}
async function checkAuth(){
  auth=undefined;$('refresh').disabled=true;$('auth').textContent='检查中…';buttonState();
  try{auth=await api('/auth');$('auth').textContent=auth.ready?'已登录：'+auth.login:'未登录';$('login').hidden=auth.ready}
  catch(error){$('auth').textContent='检查失败：'+error.message}
  finally{$('refresh').disabled=busy;buttonState()}
}
$('ack').onchange=buttonState;$('refresh').onclick=checkAuth;
$('cancel').onclick=async()=>{
  try{await api('/cancel',{});busy=true;$('result').textContent='已取消';for(const id of ['confirm','cancel','refresh'])$(id).disabled=true}
  catch(error){$('result').textContent=error.message}
};
$('confirm').onclick=async()=>{
  busy=true;buttonState();$('cancel').disabled=true;$('refresh').disabled=true;
  try{await api('/confirm',{replaceTag:$('ack').checked});$('progress').hidden=false;poll()}
  catch(error){$('result').textContent=error.message;busy=false;$('cancel').disabled=false;$('refresh').disabled=false;buttonState()}
};
async function poll(){
  try{
    const value=await api('/progress');$('progress').textContent=value.messages.join('\n');
    if(value.status==='running')return setTimeout(poll,800);
    $('result').textContent=value.status==='complete'?'发布完成':'发布失败：'+value.error;
    if(value.url){const link=document.createElement('a');link.href=value.url;link.textContent='打开 GitHub Release';link.rel='noreferrer';$('link').append(link)}
  }catch(error){$('result').textContent=error.message}
}
load();checkAuth();</script></html>`
}
export async function serveReview({ approved, remote, repository, authenticate, publish, onClose = () => {} }) {
  const token = randomBytes(32).toString('hex')
  let origin, auth = { ready: false }, status = 'ready', closed = false
  const messages = [], outcome = {}
  const replaceTag = Boolean(remote.tag || remote.localTag)
  const blocked = remote.release && !remote.release.draft ? '该版本已发布，不能覆盖，请提升版本号并重新打包。' : undefined
  const close = () => { if (!closed) { closed = true; server.close(() => onClose({ status, ...outcome })); server.closeIdleConnections() } }
  const validToken = value => typeof value === 'string' && value.length === token.length && timingSafeEqual(Buffer.from(value), Buffer.from(token))
  const server = createServer(async (req, res) => {
    const reply = (code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type + '; charset=utf-8' }); res.end(type === 'application/json' ? JSON.stringify(body) : body) }
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${token}'; style-src 'nonce-${token}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`)
    try {
      assert.equal(req.headers.host, new URL(origin).host, '无效的 Host')
      const url = new URL(req.url, origin)
      const authorized = validToken(req.headers['x-review-token']) || (req.method === 'GET' && url.pathname === '/' && validToken(url.searchParams.get('token')))
      if (!authorized) return reply(403, { error: '审核令牌无效' })
      if (req.method === 'GET' && url.pathname === '/') return reply(200, html(token), 'text/html')
      if (req.method === 'GET' && url.pathname === '/state') {
        return reply(200, { approved: { tag: approved.tag, apk: { file: approved.apk.file, bytes: approved.apk.bytes }, notes: approved.notes }, repository, replaceTag, blocked })
      }
      if (req.method === 'GET' && url.pathname === '/auth') {
        auth = await authenticate()
        return reply(200, auth)
      }
      if (req.method === 'GET' && url.pathname === '/progress') return reply(200, { status, messages, ...outcome })
      if (req.method !== 'POST' || !['/cancel', '/confirm'].includes(url.pathname)) return reply(404, { error: '未找到' })
      if (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') return reply(403, { error: '仅接受本机审核页操作' })
      let input = ''
      for await (const chunk of req) { input += chunk; if (input.length > 1024) throw new Error('请求过大') }
      const body = JSON.parse(input)
      if (status !== 'ready') return reply(409, { error: '审核已结束或正在发布' })
      if (url.pathname === '/cancel') { status = 'cancelled'; reply(200, { status }); setTimeout(close, 150); return }
      assert.ok(!blocked, blocked); assert.ok(auth.ready, '请先登录 GitHub CLI 并重新检查')
      assert.ok(!replaceTag || body.replaceTag === true, '请明确确认同名标签的调整')
      status = 'running'
      reply(202, { status })
      Promise.resolve().then(() => publish(auth, message => messages.push(message))).then(url => { status = 'complete'; outcome.url = url }).catch(error => { status = 'failed'; outcome.error = error.message; console.error('发布失败：' + error.message) }).finally(() => setTimeout(close, 4000))
    } catch (error) { if (!res.headersSent) reply(400, { error: error.message }) }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  origin = 'http://127.0.0.1:' + server.address().port
  return { url: origin + '/?token=' + token, origin, token, close }
}
