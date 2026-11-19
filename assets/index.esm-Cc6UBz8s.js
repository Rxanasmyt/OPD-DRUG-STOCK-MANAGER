import{G as R,H as y,_ as L,I as U,J as $,K as S,L as x,M as F,N as M,O as N,P as G}from"./vendor-firebase-m0sEMQac.js";/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const H="type.googleapis.com/google.protobuf.Int64Value",J="type.googleapis.com/google.protobuf.UInt64Value";function v(e,t){const r={};for(const n in e)e.hasOwnProperty(n)&&(r[n]=t(e[n]));return r}function A(e){if(e==null)return null;if(e instanceof Number&&(e=e.valueOf()),typeof e=="number"&&isFinite(e)||e===!0||e===!1||Object.prototype.toString.call(e)==="[object String]")return e;if(e instanceof Date)return e.toISOString();if(Array.isArray(e))return e.map(t=>A(t));if(typeof e=="function"||typeof e=="object")return v(e,t=>A(t));throw new Error("Data cannot be encoded in JSON: "+e)}function g(e){if(e==null)return e;if(e["@type"])switch(e["@type"]){case H:case J:{const t=Number(e.value);if(isNaN(t))throw new Error("Data cannot be decoded from JSON: "+e);return t}default:throw new Error("Data cannot be decoded from JSON: "+e)}return Array.isArray(e)?e.map(t=>g(t)):typeof e=="function"||typeof e=="object"?v(e,t=>g(t)):e}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const E="functions";/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const b={OK:"ok",CANCELLED:"cancelled",UNKNOWN:"unknown",INVALID_ARGUMENT:"invalid-argument",DEADLINE_EXCEEDED:"deadline-exceeded",NOT_FOUND:"not-found",ALREADY_EXISTS:"already-exists",PERMISSION_DENIED:"permission-denied",UNAUTHENTICATED:"unauthenticated",RESOURCE_EXHAUSTED:"resource-exhausted",FAILED_PRECONDITION:"failed-precondition",ABORTED:"aborted",OUT_OF_RANGE:"out-of-range",UNIMPLEMENTED:"unimplemented",INTERNAL:"internal",UNAVAILABLE:"unavailable",DATA_LOSS:"data-loss"};class f extends R{constructor(t,r,n,s){super(`${E}/${t}`,r||"",s!=null?{url:s}:void 0),this.details=n,Object.setPrototypeOf(this,f.prototype)}}function j(e){if(e>=200&&e<300)return"ok";switch(e){case 0:return"internal";case 400:return"invalid-argument";case 401:return"unauthenticated";case 403:return"permission-denied";case 404:return"not-found";case 409:return"aborted";case 429:return"resource-exhausted";case 499:return"cancelled";case 500:return"internal";case 501:return"unimplemented";case 503:return"unavailable";case 504:return"deadline-exceeded"}return"unknown"}function w(e,t,r){let n=j(e),s=n,i;try{const c=t&&t.error;if(c){const o=c.status;if(typeof o=="string"){if(!b[o])return new f("internal",`Unknown backend error status: ${o} [${e}]`,void 0,r);n=b[o],s=`Backend error status: ${o}`}const a=c.message;typeof a=="string"&&(s=a),i=c.details,i!==void 0&&(i=g(i))}}catch{}return n==="ok"?null:new f(n,`${s} [${e}]`,i,r)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class q{constructor(t,r,n,s){this.app=t,this.auth=null,this.messaging=null,this.appCheck=null,this.serverAppAppCheckToken=null,G(t)&&t.settings.appCheckToken&&(this.serverAppAppCheckToken=t.settings.appCheckToken),this.auth=r.getImmediate({optional:!0}),this.messaging=n.getImmediate({optional:!0}),this.auth||r.get().then(i=>this.auth=i,()=>{}),this.messaging||n.get().then(i=>this.messaging=i,()=>{}),this.appCheck||s==null||s.get().then(i=>this.appCheck=i,()=>{})}async getAuthToken(){if(this.auth)try{const t=await this.auth.getToken();return t==null?void 0:t.accessToken}catch{return}}async getMessagingToken(){if(!(!this.messaging||!("Notification"in self)||Notification.permission!=="granted"))try{return await this.messaging.getToken()}catch{return}}async getAppCheckToken(t){if(this.serverAppAppCheckToken)return this.serverAppAppCheckToken;if(this.appCheck){const r=t?await this.appCheck.getLimitedUseToken():await this.appCheck.getToken();return r.error?null:r.token}return null}async getContext(t){const r=await this.getAuthToken(),n=await this.getMessagingToken(),s=await this.getAppCheckToken(t);return{authToken:r,messagingToken:n,appCheckToken:s}}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const k="us-central1",V=/^data: (.*?)(?:\n|$)/;function B(e){let t=null;return{promise:new Promise((r,n)=>{t=setTimeout(()=>{n(new f("deadline-exceeded","deadline-exceeded"))},e)}),cancel:()=>{t&&clearTimeout(t)}}}class K{constructor(t,r,n,s,i=k,c=(...o)=>fetch(...o)){this.app=t,this.fetchImpl=c,this.emulatorOrigin=null,this.contextProvider=new q(t,r,n,s),this.cancelAllRequests=new Promise(o=>{this.deleteService=()=>Promise.resolve(o())});try{const o=new URL(i);this.customDomain=o.origin+(o.pathname==="/"?"":o.pathname),this.region=k}catch{this.customDomain=null,this.region=i}}_delete(){return this.deleteService()}_url(t){const r=this.app.options.projectId;return this.emulatorOrigin!==null?`${this.emulatorOrigin}/${r}/${this.region}/${t}`:this.customDomain!==null?`${this.customDomain}/${t}`:`https://${this.region}-${r}.cloudfunctions.net/${t}`}}function X(e,t,r){const n=S(t);e.emulatorOrigin=`http${n?"s":""}://${t}:${r}`,n&&x(e.emulatorOrigin+"/backends")}function Y(e,t,r){const n=s=>Q(e,t,s,r||{});return n.stream=(s,i)=>Z(e,t,s,i),n}function W(e,t,r){const n=s=>I(e,t,s,r||{});return n.stream=(s,i)=>_(e,t,s,i||{}),n}function P(e){return e.emulatorOrigin&&S(e.emulatorOrigin)?"include":void 0}async function z(e,t,r,n,s){r["Content-Type"]="application/json";let i;try{i=await n(e,{method:"POST",body:JSON.stringify(t),headers:r,credentials:P(s)})}catch{return{status:0,json:null}}let c=null;try{c=await i.json()}catch{}return{status:i.status,json:c}}async function D(e,t){const r={},n=await e.contextProvider.getContext(t.limitedUseAppCheckTokens);return n.authToken&&(r.Authorization="Bearer "+n.authToken),n.messagingToken&&(r["Firebase-Instance-ID-Token"]=n.messagingToken),n.appCheckToken!==null&&(r["X-Firebase-AppCheck"]=n.appCheckToken),r}function Q(e,t,r,n){const s=e._url(t);return I(e,s,r,n)}async function I(e,t,r,n){r=A(r);const s={data:r},i=await D(e,n),c=n.timeout||7e4,o=B(c),a=await Promise.race([z(t,s,i,e.fetchImpl,e),o.promise,e.cancelAllRequests]);if(o.cancel(),!a)throw new f("cancelled","Firebase Functions instance was deleted.");const h=w(a.status,a.json,t);if(h)throw h;if(!a.json)throw new f("internal","Response is not valid JSON object.",void 0,t);let l=a.json.data;if(typeof l>"u"&&(l=a.json.result),typeof l>"u")throw new f("internal","Response is missing data field.",void 0,t);return{data:g(l)}}function Z(e,t,r,n){const s=e._url(t);return _(e,s,r,n||{})}async function _(e,t,r,n){var m;r=A(r);const s={data:r},i=await D(e,n);i["Content-Type"]="application/json",i.Accept="text/event-stream";let c;try{c=await e.fetchImpl(t,{method:"POST",body:JSON.stringify(s),headers:i,signal:n==null?void 0:n.signal,credentials:P(e)})}catch(d){if(d instanceof Error&&d.name==="AbortError"){const T=new f("cancelled","Request was cancelled.");return{data:Promise.reject(T),stream:{[Symbol.asyncIterator](){return{next(){return Promise.reject(T)}}}}}}const p=w(0,null,t);return{data:Promise.reject(p),stream:{[Symbol.asyncIterator](){return{next(){return Promise.reject(p)}}}}}}let o,a;const h=new Promise((d,p)=>{o=d,a=p});(m=n==null?void 0:n.signal)==null||m.addEventListener("abort",()=>{const d=new f("cancelled","Request was cancelled.");a(d)});const l=c.body.getReader(),u=ee(l,o,a,n==null?void 0:n.signal,t);return{stream:{[Symbol.asyncIterator](){const d=u.getReader();return{async next(){const{value:p,done:T}=await d.read();return{value:p,done:T}},async return(){return await d.cancel(),{done:!0,value:void 0}}}}},data:h}}function ee(e,t,r,n,s){const i=(o,a)=>{const h=o.match(V);if(!h)return;const l=h[1];try{const u=JSON.parse(l);if("result"in u){t(g(u.result));return}if("message"in u){a.enqueue(g(u.message));return}if("error"in u){const m=w(0,u,s);a.error(m),r(m);return}}catch(u){if(u instanceof f){a.error(u),r(u);return}}},c=new TextDecoder;return new ReadableStream({start(o){let a="";return h();async function h(){if(n!=null&&n.aborted){const l=new f("cancelled","Request was cancelled");return o.error(l),r(l),Promise.resolve()}try{const{value:l,done:u}=await e.read();if(u){a.trim()&&i(a.trim(),o),o.close();return}if(n!=null&&n.aborted){const d=new f("cancelled","Request was cancelled");o.error(d),r(d),await e.cancel();return}a+=c.decode(l,{stream:!0});const m=a.split(`
`);a=m.pop()||"";for(const d of m)d.trim()&&i(d.trim(),o);return h()}catch(l){const u=l instanceof f?l:w(0,null,s);o.error(u),r(u)}}},cancel(){return e.cancel()}})}const C="@firebase/functions",O="0.14.0";/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const te="auth-internal",ne="app-check-internal",re="messaging-internal";function se(e){const t=(r,{instanceIdentifier:n})=>{const s=r.getProvider("app").getImmediate(),i=r.getProvider(te),c=r.getProvider(re),o=r.getProvider(ne);return new K(s,i,c,o,n)};F(new M(E,t,"PUBLIC").setMultipleInstances(!0)),N(C,O,e),N(C,O,"esm2020")}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function ae(e=$(),t=k){const n=L(y(e),E).getImmediate({identifier:t}),s=U("functions");return s&&ie(n,...s),n}function ie(e,t,r){X(y(e),t,r)}function ce(e,t,r){return Y(y(e),t,r)}function ue(e,t,r){return W(y(e),t,r)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */se();export{f as FunctionsError,ie as connectFunctionsEmulator,ae as getFunctions,ce as httpsCallable,ue as httpsCallableFromURL};
