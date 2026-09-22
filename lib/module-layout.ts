import { storeFormatRegistry, type StoreFormatType, type SlotDefinition } from "./store-formats";

export const currentLayoutVersion = "shared-v1";
export const signImageSizes = { default: {width:376,height:170}, classic:{width:376,height:145} };
type Grid = { columns: number[]; rows: number[]; tiles: [number,number,number,number][]; aspect: number };
// [column start, row start, column span, row span]. Preserve the approved MVP geometry.
export const posterLayouts: Record<string,Grid> = {
  single:{columns:[1],rows:[1],tiles:[[0,0,1,1]],aspect:1},
  double:{columns:[1,1],rows:[1],tiles:[[0,0,1,1],[1,0,1,1]],aspect:1},
  triple:{columns:[1,1,1],rows:[1],tiles:[[0,0,1,1],[1,0,1,1],[2,0,1,1]],aspect:1},
  combo1:{columns:[1.8,1],rows:[1,1],tiles:[[0,0,1,2],[1,0,1,1],[1,1,1,1]],aspect:1},
  combo2:{columns:[1,1.8],rows:[1,1],tiles:[[0,0,1,1],[0,1,1,1],[1,0,1,2]],aspect:1},
  combo3:{columns:[1,1],rows:[1.8,1],tiles:[[0,0,2,1],[0,1,1,1],[1,1,1,1]],aspect:1},
};
const pixels=(weights:number[],total:number)=>{const sum=weights.reduce((a,b)=>a+b,0);return weights.map(weight=>(total-(weights.length-1))*weight/sum);};
export function moduleSlots(type:string,variant:string,layoutVersion?:string): readonly SlotDefinition[] {
  const format=storeFormatRegistry[type as StoreFormatType];
  const slots=(format.variants[variant as never] as {slots:readonly SlotDefinition[]}).slots;
  if(layoutVersion!==currentLayoutVersion)return slots;
  if(type==="shopSign") { const size=signImageSizes[variant as keyof typeof signImageSizes]; return slots.map(slot=>({...slot,ratio:`${size.width}:${size.height}`})); }
  if(type==="poster"&&variant==="slider")return slots.map(slot=>({...slot,ratio:"234:400"}));
  const layout=type==="poster"?posterLayouts[variant]:undefined;
  if(!layout)return slots;
  const widths=pixels(layout.columns,1080),heights=pixels(layout.rows,1080/layout.aspect);
  return slots.map((slot,index)=>{const [x,y,w,h]=layout.tiles[index];const width=widths.slice(x,x+w).reduce((a,b)=>a+b,0)+w-1;const height=heights.slice(y,y+h).reduce((a,b)=>a+b,0)+h-1;return {...slot,ratio:`${Number(width.toFixed(4))}:${Number(height.toFixed(4))}`};});
}
