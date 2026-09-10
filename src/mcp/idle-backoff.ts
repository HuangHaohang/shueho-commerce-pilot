/** Busy workers remain responsive; an idle worker performs at most one poll per 30 seconds. */
export class IdleBackoff {
 private empty=0;private next=0;
 constructor(private now:()=>number=Date.now){}
 ready(){return this.now()>=this.next;}
 observed(work:boolean){this.empty=work?0:Math.min(5,this.empty+1);this.next=this.now()+(work?0:Math.min(30000,1000*2**this.empty));}
}
