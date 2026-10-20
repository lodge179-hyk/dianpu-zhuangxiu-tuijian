const fs=require('fs');
const path=require('path');
const sharp=require('sharp');

async function prepareProductReferences(folder,batch,offset=0){
  if(!batch.studio?.options.preserveProducts)return {images:[],records:[]};
  const references=batch.productReferences||[];
  const indexes=[...new Set(references.map(p=>p.imageIndex))];
  if(indexes.some(i=>!Number.isInteger(i)||i<1||i>6))throw Error('商品原图引用无效，未发起生图。');
  const images=[],records=[];
  for(const index of indexes){
    const file=`input-${index}.jpg`,absolute=path.join(folder,file);
    if(!fs.existsSync(absolute))throw Error(`保真所需的第${index}张商品原图缺失，未发起生图。`);
    const bytes=await sharp(absolute).resize({width:1800,height:3000,fit:'inside',withoutEnlargement:true}).jpeg({quality:92}).toBuffer();
    images.push('data:image/jpeg;base64,'+bytes.toString('base64'));
    records.push({attachment:offset+images.length,imageIndex:index,file,products:references.filter(p=>p.imageIndex===index).map(p=>({evidenceId:p.evidenceId,description:p.description})),role:'原商品身份依据，不是视觉风格案例'});
  }
  return {images,records};
}
module.exports={prepareProductReferences};
