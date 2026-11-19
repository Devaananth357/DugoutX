export const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
export function seededUnit(seed:string){let hash=2166136261;for(const char of seed){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}return((hash>>>0)%10000)/10000;}
export function average(values:number[]){return values.length?values.reduce((sum,value)=>sum+value,0)/values.length:0;}
