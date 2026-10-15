export const MAX_ROUNDS=8, MAX_DURATION_MS=90*60*1000;
export class Budget {
  constructor({rounds=MAX_ROUNDS,durationMs=MAX_DURATION_MS,now=Date.now,onExpire,setTimer=setTimeout,clearTimer=clearTimeout}) {
    if(!Number.isInteger(rounds)||rounds<1||rounds>MAX_ROUNDS)throw Error('rounds_must_be_1_to_8');
    if(!Number.isInteger(durationMs)||durationMs<1||durationMs>MAX_DURATION_MS)throw Error('duration_must_be_at_most_90_minutes');
    this.maxRounds=rounds;this.now=now;this.started=now();this.deadline=this.started+durationMs;this.onExpire=onExpire;this.clearTimer=clearTimer;
    this.timer=setTimer(()=>{this.expire('deadline');},durationMs);this.timer.unref?.();
  }
  expire(reason) {if(this.terminal)return;this.terminal=reason;this.clearTimer(this.timer);this.onExpire(reason);}
  check(round=1) {if(this.terminal)return false;if(this.now()>=this.deadline)this.expire('deadline');else if(round>this.maxRounds)this.expire('round_limit');return !this.terminal;}
  finish() {if(this.terminal)return false;if(!this.check())return false;this.terminal='complete';this.clearTimer(this.timer);return true;}
  dispose() {this.clearTimer(this.timer);}
}
