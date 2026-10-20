// Bounded partitioning (24 assets), no exponential SKU combinations. Keep each
// panel large enough to read; use up to six sheets instead of squeezing the page.
function studioBatches(assets, ratios, maxBatches=6) {
  const hero=assets.find(a=>a.id==='overview');
  let ordered=hero?[hero,...assets.filter(a=>a!==hero)]:[...assets];
  const rowsFor=part=>{
    const groups=new Map();
    for(const a of part){if(!groups.has(a.aspect))groups.set(a.aspect,[]);groups.get(a.aspect).push(a.id);}
    // Try both compact rows and wider, higher-resolution individual panels.
    for(const columns of [2,3,1]){
      const rows=[];
      for(const [aspect,ids] of groups){const n=aspect==='3:1'?1:columns;for(let i=0;i<ids.length;i+=n)rows.push(ids.slice(i,i+n));}
      const lookup=new Map(part.map(a=>[a.id,a.aspect]));
      const shape=rows.reduce((s,row)=>s+1/(row.length*ratios[lookup.get(row[0])]),0);
      if(rows.length<=4&&shape>=.45&&shape<=2.8)return rows;
    }
    return null;
  };
  const memo=new Map();
  function solve(offset,left){
    if(offset===ordered.length)return [];
    if(!left||ordered.length-offset>left*6)return null;
    const key=offset+':'+left;if(memo.has(key))return memo.get(key);
    // Prefer four panels when the budget allows it; six remain available for icons.
    for(const size of [4,3,5,6,2,1]){
      if(offset+size>ordered.length)continue;
      const rows=rowsFor(ordered.slice(offset,offset+size));if(!rows)continue;
      const tail=solve(offset+size,left-1);if(tail){const result=[rows,...tail];memo.set(key,result);return result;}
    }
    memo.set(key,null);return null;
  }
  let rows=solve(0,maxBatches);
  // Rendering order lives in modules, not sheets. Regroup ratios when adjacent
  // narrative panels are geometrically incompatible, keeping the hero first.
  if(!rows){ordered=[...(hero?[hero]:[]),...assets.filter(a=>a!==hero).sort((a,b)=>ratios[b.aspect]-ratios[a.aspect])];memo.clear();rows=solve(0,maxBatches);}
  if(!rows)throw Error('当前素材比例无法可靠分批，请在设计修订中调整比例或减少重复画面。');
  return rows.map((rows,i)=>({id:`structure-${i+1}`,rows}));
}
module.exports={studioBatches};
