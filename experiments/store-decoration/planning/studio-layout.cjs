const {renderModule}=require('../a9-component-library/lib/index.cjs');
// Measure the actual platform components. Sliding images occupy one row;
// image count alone cannot predict the length of a storefront.
function measureStudioModules(modules){
 const rows=modules.map((m,index)=>{
  const count=m.props?.assetIds.length??m.visuals?.length??0;
  const images=Array.from({length:count},()=>({src:'measure.png',label:'分类'}));
  const content=m.type.startsWith('signboard.')?{...(count?{background:'measure.png'}:{}),shop:{name:'店铺',avatar:'avatar.png',vip:false,newCount:'—',totalCount:'—'}}
   :m.type.startsWith('text.')?{text:m.props?.text??m.text??'说明'}
   :m.type.startsWith('showcase.')?{items:images.map(i=>({image:i.src,title:'商品',price:'',currency:''}))}:{images};
  const result=renderModule({id:'measure-'+index,type:m.type,content,options:{}});
  return {type:m.type,height:result.height,images:count};
 });
 return {width:483,height:rows.reduce((sum,m)=>sum+m.height,0),modules:rows};
}
module.exports={measureStudioModules};
