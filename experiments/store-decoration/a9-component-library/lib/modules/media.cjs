const{count,keys}=require('../core.cjs');
module.exports=function media(c){const m=c.module,d=m.content||{},s=c.source;keys(d,['images'],'media content');keys(m.options,[],'media options');let slots=s.nodes.filter(n=>n.tag==='IMG'&&!/cart|icon/i.test(n.name));
// One module is one row of five navigation items or one single-column poster.
// The extra rows in the capture are source content, not this module's shape.
if(m.type==='navigation.five')slots=slots.slice(0,5);
if(m.type==='poster.single')slots=slots.slice(0,1);
const images=d.images;const isCombo=m.type.startsWith('poster.combo');count(images,slots.length,m.type,isCombo?slots.length:1);let html='';for(let i=0;i<images.length;i++){const image=images[i];if(typeof image==='object')keys(image,['src','label'],'image content');html+=c.photo(slots[i].rect,m.id+'.image'+(i+1),image,{round:m.type.startsWith('navigation.')});if(m.type==='navigation.five'){const label=c.optional('DecorateNav_label.'+(i+1));if(label&&typeof image==='object'&&image.label!==undefined)html+=c.text(label,m.id+'.label'+(i+1),image.label,{multiline:true,extra:`text-align:${label.style['text-align']||'center'};`});}}
let height=s.height;
if(m.type==='poster.single')height=images.length*(slots[0].rect[3]+1);
if(m.type==='navigation.five'&&images.length<=5){const firstRow=s.nodes.filter(n=>/DecorateNav_(image|label)\.[1-5]$/.test(n.name));height=Math.max(...firstRow.map(n=>n.rect[1]+n.rect[3]))+16;}
return{html,height};};
