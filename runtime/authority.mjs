import {randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
const REQUIRED=['hostValid','enabled','sourceValid','oracle','phases','checks','delivery','constraints','goalValid'];
export class TaskAuthority {
  #key=randomBytes(32); #issued;
  certify(facts) {
    const blockers=REQUIRED.filter(k=>facts[k]!==true);
    if(!facts.identity?.session||!facts.identity?.candidate||!facts.identity?.goal?.id)blockers.push('identity');
    if(blockers.length){this.#issued=undefined;return {blockers};}
    const body={protocol:'native-file-contract/v1',identity:structuredClone(facts.identity),issuedAt:new Date().toISOString(),claims:[...REQUIRED]};
    this.#issued={...body,digest:this.#sign(body)};return {certificate:structuredClone(this.#issued),blockers:[]};
  }
  #sign(body){return createHmac('sha256',this.#key).update(JSON.stringify(body)).digest('hex');}
  current(identity){
    if(!this.#issued||JSON.stringify(this.#issued.identity)!==JSON.stringify(identity))return false;
    const {digest,...body}=this.#issued;const expected=this.#sign(body);
    return digest.length===expected.length&&timingSafeEqual(Buffer.from(digest),Buffer.from(expected));
  }
  read(){return this.#issued?structuredClone(this.#issued):undefined;}
}
