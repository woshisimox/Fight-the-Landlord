export class RNG {
  private seed:number;
  constructor(seed:number){ this.seed = seed>>>0; }
  next():number{ let x=this.seed; x^=x<<13; x^=x>>>17; x^=x<<5; this.seed=x>>>0; return this.seed/0xFFFFFFFF; }
  shuffle<T>(arr:T[]):void{ for(let i=arr.length-1;i>0;i--){ const j=Math.floor(this.next()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; } }
}
