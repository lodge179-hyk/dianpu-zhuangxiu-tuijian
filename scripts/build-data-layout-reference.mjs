import fs from 'node:fs/promises';
import sharp from 'sharp';
const out='output/whole-page-mvp-data-v2';await fs.mkdir(out,{recursive:true});
const measurements=JSON.parse(await fs.readFile('output/whole-page-mvp-20260915/live-preview-measurements.json','utf8'));
const css=await fs.readFile('output/wego-external-capture-20260915/export/captured-styles.css','utf8');
const node=(fragment)=>measurements.nodes.find(n=>n.class.includes(fragment));
const W=measurements.nodes[0].rect.width;
const side=8, gap=8, navD=node('DecorateNav-module_image_').rect.width;
const fontNav=Number.parseFloat(node('DecorateNav-module_label_').style['font-size']);
const lineNav=Number.parseFloat(node('DecorateNav-module_label_').style['line-height']);
const imageWidth=(W-2*side-2*gap)/3;
const infoH=node('CommodityItem-module_info_').rect.height;
const titleFont=Number.parseFloat(node('CommodityItem-module_title_').style['font-size']);
const titleLine=Number.parseFloat(node('CommodityItem-module_title_').style['line-height']);
const screenshot=await fs.readFile('output/whole-page-mvp-20260915/inputs/real-miniapp-reference.jpg');
const meta=await sharp(screenshot).metadata();
// Only the source screenshot supplies mini-program-specific chrome. This is an
// explicit observed crop boundary, not a purported DOM-derived measurement.
const sourceHeaderEnd=284, headerH=sourceHeaderEnd/meta.width*W;
const navH=2*side+16+navD+4+lineNav;
const carouselY=headerH+navH,carouselH=W*3/4;
const productsY=carouselY+carouselH+side;
const H=Math.ceil(productsY+imageWidth+infoH+side);
const cartUrl='https://xcimg.szwego.com/product/default_theme_addCart.jpg';
const res=await fetch(cartUrl);if(!res.ok)throw Error('Cart asset '+res.status);const cart=Buffer.from(await res.arrayBuffer());await fs.writeFile(out+'/native-cart.png',cart);
const imageData='data:image/jpeg;base64,'+screenshot.toString('base64');const cartData='data:image/png;base64,'+cart.toString('base64');
const labels=['唇膜','口红礼盒','燕窝礼盒','全部商品'];
const titles=['海蓝之谜唇膜','口红礼盒','燕窝礼盒'];
const slots=[];
let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W*3}" height="${H*3}" viewBox="0 0 ${W} ${H}"><defs><clipPath id="header"><rect width="${W}" height="${headerH}"/></clipPath></defs><rect width="${W}" height="${H}" fill="white"/><image href="${imageData}" width="${W}" height="${meta.height/meta.width*W}" clip-path="url(#header)"/><g font-family="Microsoft YaHei, sans-serif">`;
const cellW=(W-2*side-3*gap)/4;
for(let i=0;i<4;i++){const x=side+i*(cellW+gap)+(cellW-navD)/2,y=headerH+16;slots.push({kind:'navigation',index:i,x,y,width:navD,height:navD});svg+=`<circle cx="${x+navD/2}" cy="${y+navD/2}" r="${navD/2}" fill="#e9ebed"/><text x="${x+navD/2}" y="${y+navD+4+fontNav}" fill="#626266" font-size="${fontNav}" text-anchor="middle">${labels[i]}</text>`;}
svg+=`<rect x="0" y="${carouselY}" width="${W}" height="${carouselH}" fill="#e2e5e7"/>`;
for(let i=0;i<3;i++)svg+=`<circle cx="${W/2+(i-1)*10}" cy="${carouselY+carouselH-10}" r="2.5" fill="${i?'#b4b9bd':'white'}"/>`;
slots.push({kind:'carousel',x:0,y:carouselY,width:W,height:carouselH});
for(let i=0;i<3;i++){const x=side+i*(imageWidth+gap);slots.push({kind:'product',index:i,x,y:productsY,width:imageWidth,height:imageWidth});svg+=`<rect x="${x}" y="${productsY}" width="${imageWidth}" height="${imageWidth}" fill="#eceeef"/><text x="${x}" y="${productsY+imageWidth+8+titleFont}" fill="#1e2028" font-size="${titleFont}">${titles[i]}</text><image href="${cartData}" x="${x+imageWidth-20}" y="${productsY+imageWidth+infoH-28}" width="20" height="20"/>`;}
svg+='</g></svg>';
await fs.writeFile(out+'/layout-reference.svg',svg);await sharp(Buffer.from(svg)).png().toFile(out+'/layout-reference.png');
const sourceRules=css.split('\n\n').filter(r=>/DecorateNav-module_|CommodityItem-module_|CommodityColumn-module_|DecorateSwiper-module_|DecorateCommodity-module_/.test(r));await fs.writeFile(out+'/captured-module-rules.css',sourceRules.join('\n\n'));
const manifest={baseWidth:W,height:H,scale:3,header:{height:headerH,source:'real-miniapp-reference.jpg',sourceWidth:meta.width,sourceCropYEnd:sourceHeaderEnd,status:'截图保留：非DOM实测；沿用截图原有店名，生图时替换身份'},navigation:{diameter:navD,fontSize:fontNav,lineHeight:lineNav,labelMarginTop:4,padding:side,itemMarginY:8,height:navH},carousel:{width:W,height:carouselH,objectFit:'cover',radius:0},showcase:{side,gap,imageWidth,infoHeight:infoH,titleFont,titleLine,cartSize:20},slots,sourceData:'../whole-page-mvp-20260915/live-preview-measurements.json',limitations:['仅导航、轮播、橱窗尺寸和主要字体来自网页预览数据，尚非全部小程序数据。','小程序顶部直接保留原截图像素；文字和图标分辨率受315px原图限制。','圈内和图片槽位为空占位，实际商品的裁切和设计仍由生图模型执行。','轮播指示点为渲染占位，其精确尺寸未抓取；小程序商品分享图标需真实截图补充。']};
await fs.writeFile(out+'/layout-data.json',JSON.stringify(manifest,null,2));
console.log(JSON.stringify({W,H,headerH,navH,carouselY,productsY,imageWidth,infoH,slots},null,2));

