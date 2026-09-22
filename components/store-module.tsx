import { posterLayouts, signImageSizes, moduleSlots, currentLayoutVersion } from "../lib/module-layout";
import { ExternalLink, LoaderCircle } from "lucide-react";
import type { StoreFormatType } from "../lib/store-formats";
import StoreShowcase, { type ShowcaseProduct } from "./store-showcase";
import "./store-module.css";

export type StoreModuleProps = {
  id: string;
  type: StoreFormatType;
  variant: string;
  title?: string;
  items: ShowcaseProduct[];
};

/** Acceptance and production previews differ only in their content. */
export default function StoreModule({ id, type, variant, title, items }: StoreModuleProps) {
  const text = title ?? (type === "shopSign" ? "店铺招牌" : "本期推荐");
  const mediaRatio = type === "shopSign" && variant !== "minimal" ? signImageSizes[variant as keyof typeof signImageSizes].width / signImageSizes[variant as keyof typeof signImageSizes].height : type === "carousel" ? moduleSlots(type,variant,currentLayoutVersion)[0].ratio.split(":").map(Number).reduce((a,b)=>a/b) : undefined;
  const grid = type === "poster" ? posterLayouts[variant] : undefined;
  const slots = items.length ? <div className="slot-grid" style={grid ? {display:"grid",gridTemplateColumns:grid.columns.map(n=>`minmax(0, ${n}fr)`).join(" "),gridTemplateRows:grid.rows.map(n=>`minmax(0, ${n}fr)`).join(" "),aspectRatio:grid.aspect} : undefined}>{items.map((item, index) => <div key={`${item.id}-${index}`} className={item.state ? `${item.state}-slot` : undefined} style={grid && grid.tiles[index] ? {gridColumn:`${grid.tiles[index][0]+1} / span ${grid.tiles[index][2]}`,gridRow:`${grid.tiles[index][1]+1} / span ${grid.tiles[index][3]}`} : mediaRatio ? {aspectRatio:mediaRatio,height:"auto"} : undefined}>
    {item.src ? <img src={item.src} alt={item.name} style={item.preserveWhole ? {objectFit:"contain",borderRadius:0} : undefined}/> : <span className="slot-loading"><LoaderCircle className="spin"/></span>}
    {item.preserveWhole && <small className="crop-warning">原图完整显示 · 待确认适配</small>}
    {type === "navigation" && <small className="navigation-label">{item.name}</small>}
  </div>)}</div> : null;
  let content;
  if (type === "showcase") content = <StoreShowcase variant={variant} products={items}/>;
  else if (type === "shopSign") content = <><div className="native-tools"><span>10:00</span><i>搜索</i><b>•••　◉</b></div>{slots}<div className="shop-identity"><em>境</em><span><strong>{text}</strong><small>上新推荐｜欢迎进店</small></span></div></>;
  else if (type === "carousel") content = <>{slots}<span className="carousel-dots">● ○ ○</span></>;
  else if (type === "text") content = <div className={`native-copy ${variant}`}>{variant === "singleLine" ? <span>🔊 {text}</span> : variant === "link" ? <><span>{text}</span><ExternalLink size={12}/></> : text}</div>;
  else content = slots;
  return <article className={`store-renderer preview-module type-${type} variant-${variant}`} data-module-id={id} data-renderer="store-module">{content}</article>;
}
