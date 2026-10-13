const{icons,rectCss,keys}=require('../core.cjs');
module.exports=function signboard(c){const m=c.module,d=m.content||{},s=c.source,id=m.id;
// The minimal signboard has a platform-defined background, never a custom image slot.
if(m.type==='signboard.minimal'&&Object.hasOwn(d,'background'))throw Error('极简招牌不支持自定义背景图，请移除 background；头像可通过 shop.avatar 设置。');
keys(d,m.type==='signboard.minimal'?['shop']:['background','shop'],'signboard content');keys(m.options,[],'signboard options');const shop=d.shop||{};keys(shop,['name','avatar','vip','newCount','totalCount'],'shop');for(const k of ['name','avatar','newCount','totalCount'])if(shop[k]===undefined)throw Error('Missing shop '+k);let html='';
if(m.type==='signboard.default'){
 html+=c.photo([0,0,483,258],id+'.banner.photo',d.background);
 html+=`<div class="component" ${c.attrs(id+'.banner.shade','fixed-overlay',[0,170,483,88])} style="left:0;top:170px;width:483px;height:88px;background:linear-gradient(transparent,rgba(0,0,0,.3))"></div>`;
}else{
 const bg=c.optional('DecorateSignboard_banner.1')||c.optional('SignboardSwiper_image.1');if(bg)html+=m.type==='signboard.minimal'?c.panel(bg,id+'.banner.background'):c.photo(bg.rect,id+'.banner.photo',d.background);
 for(const n of s.nodes.filter(n=>n.style['background-image']&&n.style['background-image'].startsWith('linear-gradient')))html+=c.panel(n,id+'.'+n.name,`background-image:${n.style['background-image']};`);
}
html+=c.image(c.node('SignboardInfo_icon.1'),id+'.SignboardInfo_icon.1',shop.avatar);
if(shop.vip)html+=c.image(c.node('SignboardInfo_iconSVip.1'),id+'.SignboardInfo_iconSVip.1',icons.vip);
const values={'SignboardInfo_name.1':shop.name,'SignboardInfo_item.1':'上新','span.1':shop.newCount,'SignboardInfo_item.2':'总数','span.2':shop.totalCount};
for(const[n,v]of Object.entries(values)){const style=c.node(n);html+=c.text(style,id+'.'+n,v,{glyph:style.tag==='SPAN'});}
return{html,height:s.height};};
