// One transport for release lists, metadata and verified archives. Proxy choices
// are local to these requests; never change global agents or OS proxy settings.
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export const UPDATE_HOSTS = new Set(['github.com','codeload.github.com','api.github.com','raw.githubusercontent.com','objects.githubusercontent.com','release-assets.githubusercontent.com','cdn.jsdelivr.net']);
let systemCache;

export function bypassProxy(url, rule = '') {
  const host = url.hostname.toLowerCase(), port = url.port || (url.protocol === 'https:' ? '443' : '80');
  return rule.split(/[;,]/).some(raw => {
    const item = raw.trim().toLowerCase();
    if (!item) return false;
    if (item === '*') return true;
    if (item === '<local>') return !host.includes('.');
    const match = /^(.*?)(?::(\d+))?$/.exec(item);
    const target = match[1].replace(/^\*?\./,'');
    return (!match[2] || match[2] === port) && (host === target || host.endsWith('.' + target));
  });
}
export function windowsProxy(config, url) {
  if (!config?.ProxyEnable || !config.ProxyServer || bypassProxy(url, config.ProxyOverride)) return '';
  const parts = String(config.ProxyServer).split(';');
  const value = parts.find(p => p.startsWith(url.protocol.slice(0,-1) + '='))?.split('=').slice(1).join('=')
    || (parts.length === 1 && !parts[0].includes('=') ? parts[0] : '');
  return value ? (/^https?:\/\//i.test(value) ? value : 'http://' + value) : '';
}
async function systemProxy(url) {
  if (process.platform !== 'win32') return '';
  if (!systemCache || Date.now() - systemCache.at > 30000) {
    // Read static WinINET configuration only. PAC/WPAD is deliberately not executed.
    const exe = (process.env.SystemRoot || 'C:\\Windows') + '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
    const {stdout} = await exec(exe,['-NoProfile','-NonInteractive','-Command', "$p=Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; @{ProxyEnable=$p.ProxyEnable;ProxyServer=$p.ProxyServer;ProxyOverride=$p.ProxyOverride;AutoConfigURL=$p.AutoConfigURL}|ConvertTo-Json -Compress"], {timeout:4000,windowsHide:true,maxBuffer:16384});
    systemCache = {at:Date.now(),value:JSON.parse(stdout.replace(/^\uFEFF/,''))};
  }
  if (systemCache.value.AutoConfigURL && !systemCache.value.ProxyEnable) throw Error('更新代理使用 PAC；请为更新请求设置 PURGE_HTTPS_PROXY 或 HTTPS_PROXY');
  return windowsProxy(systemCache.value,url);
}
export async function proxyFor(url, env = process.env, discover = systemProxy) {
  if (bypassProxy(url, env.no_proxy ?? env.NO_PROXY)) return '';
  const explicit = env.PURGE_HTTPS_PROXY ?? env.https_proxy ?? env.HTTPS_PROXY ?? env.http_proxy ?? env.HTTP_PROXY;
  const value = explicit !== undefined ? explicit : await discover(url);
  if (!value) return '';
  let proxy;
  try { proxy = new URL(value); } catch { throw Error('更新代理地址无效'); }
  if (!['http:','https:'].includes(proxy.protocol)) throw Error('更新代理仅支持 HTTP/HTTPS CONNECT');
  return proxy;
}
export function githubHeaders(url, extra = {}, env = process.env) {
  const headers = {'user-agent':'dsh-purge-community-update',accept:'*/*',...extra};
  for (const key of Object.keys(headers)) if (/^(authorization|proxy-authorization)$/i.test(key)) delete headers[key];
  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  if (url.protocol === 'https:' && url.hostname === 'api.github.com' && token) headers.authorization = 'Bearer ' + token;
  return headers;
}
export function httpFailure(status, headers = {}) {
  if ((status === 403 || status === 429) && String(headers['x-ratelimit-remaining']) === '0') {
    const epoch = Number(headers['x-ratelimit-reset']);
    return `GitHub API 额度耗尽（HTTP ${status}）${epoch > 0 && epoch < 1e12 ? '，重置时间 ' + new Date(epoch*1000).toISOString() : ''}；可等待或配置 GITHUB_TOKEN / GH_TOKEN`;
  }
  if (status === 401) return 'GitHub 认证失败（HTTP 401），请检查 token';
  if (status === 403 || status === 429) return `GitHub 拒绝请求（HTTP ${status}），请检查访问权限或重试限制`;
  if (status === 404) return 'GitHub 资源不存在或无访问权限（HTTP 404）';
  if (status === 407) return '更新代理认证失败（HTTP 407）';
  return `更新请求失败：HTTP ${status}`;
}
function proxyAgent(proxy, signal) {
  const agent = new https.Agent({keepAlive:false});
  agent.createConnection = (options, callback) => {
    const host = options.hostname || options.host;
    const authority = `${net.isIP(host) === 6 ? '['+host+']' : host}:${options.port || 443}`;
    const headers = {host:authority};
    if (proxy.username || proxy.password) headers['proxy-authorization'] = 'Basic ' + Buffer.from(decodeURIComponent(proxy.username) + ':' + decodeURIComponent(proxy.password)).toString('base64');
    const transport = proxy.protocol === 'https:' ? https : http;
    const endpoint = new URL(proxy); endpoint.username=''; endpoint.password='';
    const req = transport.request(endpoint, {method:'CONNECT',path:authority,headers,signal,agent:false});
    req.once('connect',(res,socket,head) => {
      if (res.statusCode !== 200) { socket.destroy(); callback(Error(httpFailure(res.statusCode))); return; }
      if (head.length) socket.unshift(head);
      const secure = tls.connect({socket,servername:net.isIP(host) ? undefined : host, rejectUnauthorized:true});
      const abort = () => secure.destroy(Error('更新请求超时'));
      signal.addEventListener('abort',abort,{once:true});
      secure.once('close',() => signal.removeEventListener('abort',abort));
      callback(null,secure);
    });
    req.once('error',callback);
    req.end();
  };
  return agent;
}
async function once(url, headers, signal, maxBytes, options) {
  if (options.fetch) {
    const res = await options.fetch(url,{headers,signal,redirect:'manual'});
    if (res.status >= 300 && res.status < 400 || !res.ok) {
      await res.body?.cancel?.().catch(()=>{});
      return {status:res.status,headers:Object.fromEntries(res.headers),body:Buffer.alloc(0)};
    }
    if (Number(res.headers.get('content-length')) > maxBytes) { await res.body?.cancel?.().catch(()=>{}); throw Error('更新文件过大'); }
    let size=0; const chunks=[];
    for await (const chunk of res.body) { size+=chunk.length; if(size>maxBytes) throw Error('更新文件过大'); chunks.push(Buffer.from(chunk)); }
    return {status:res.status,headers:Object.fromEntries(res.headers),body:Buffer.concat(chunks)};
  }
  const proxy = await proxyFor(url,options.env || process.env, options.discoverProxy);
  if (signal.aborted) throw Error('更新请求超时');
  if (proxy && url.protocol !== 'https:') throw Error('更新代理只用于 HTTPS 下载');
  const agent = proxy ? proxyAgent(proxy,signal) : false;
  try {
    return await new Promise((resolve,reject)=>{
      const req = (url.protocol === 'https:' ? https : http).request(url,{method:'GET',headers,signal,agent},res=>{
        const status=res.statusCode||0;
        if (status<200 || status>=300) { res.destroy(); resolve({status,headers:res.headers,body:Buffer.alloc(0)}); return; }
        if(Number(res.headers['content-length'])>maxBytes) {req.destroy(Error('更新文件过大'));return;}
        let size=0; const chunks=[];
        res.on('data',chunk=>{size+=chunk.length;if(size>maxBytes)req.destroy(Error('更新文件过大'));else chunks.push(chunk);});
        res.on('end',()=>resolve({status,headers:res.headers,body:Buffer.concat(chunks)}));
        res.on('error',reject);
      });
      req.on('error',reject);req.end();
    });
  } finally { if(agent) agent.destroy(); }
}
function withinSignal(promise, signal) {
  return new Promise((resolve,reject) => {
    const abort = () => reject(Error('更新请求超时'));
    if(signal.aborted) { promise.catch(()=>{}); abort(); return; }
    signal.addEventListener('abort',abort,{once:true});
    promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
export async function requestUpdate(url, {timeout=12000,maxBytes=50*1024*1024,headers={},redirects=5,allowedHosts=UPDATE_HOSTS,...options}={}) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout); timer.unref?.();
  try {
    for(let n=0;n<=redirects;n++) {
      const target=new URL(url);
      if(target.protocol!=='https:' || target.username || target.password || !allowedHosts.has(target.hostname)) throw Error('更新下载来源无效');
      const res=await withinSignal(once(target,githubHeaders(target,headers,options.env),controller.signal,maxBytes,options),controller.signal);
      if([301,302,303,307,308].includes(res.status)) {
        if(!res.headers.location) throw Error('更新跳转无效');
        url=new URL(res.headers.location,target).href;continue;
      }
      if(res.status<200 || res.status>=300) throw Error(httpFailure(res.status,res.headers));
      return res;
    }
    throw Error('更新跳转过多');
  } catch(e) {
    if(controller.signal.aborted || e.name==='AbortError' || e.name==='TimeoutError') throw Error('更新请求超时，请检查更新代理或网络');
    // Do not include URL credentials, tokens, proxy addresses or response bodies.
    if(e.code) throw Error(`更新网络连接失败（${String(e.code).replace(/[^A-Z0-9_]/g,'')}），请检查更新代理或网络`);
    throw e;
  } finally {clearTimeout(timer);}
}
