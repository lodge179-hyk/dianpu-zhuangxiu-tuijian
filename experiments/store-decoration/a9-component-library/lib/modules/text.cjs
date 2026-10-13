const{icons,keys}=require('../core.cjs');
module.exports=function text(c){const m=c.module,d=m.content||{};keys(d,['text'],'text content');keys(m.options,[],'text options');if(d.text===undefined)throw Error('Missing text content');let html='';
if(m.type==='text.single'){html+=c.panel(c.node('ScrollNotice_ScrollNotice.1'),m.id+'.notice.background');html+=c.image(c.node('ScrollNotice_icon.1'),m.id+'.notice.icon',icons.notice);html+=c.text(c.node('ScrollNotice_line.1'),m.id+'.notice.text',d.text);}
else if(m.type==='text.multiline'){html+=c.panel(c.node('FoldNotice_FoldNotice.1'),m.id+'.notice.background');html+=c.text(c.node('EllipsisText_EllipsisText.1'),m.id+'.notice.text',d.text,{multiline:true});}
else html+=c.text(c.node('EllipsisText_EllipsisText.1'),m.id+'.link.text',d.text);
return{html,height:c.source.height};};
