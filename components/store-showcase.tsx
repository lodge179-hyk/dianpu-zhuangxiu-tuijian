import { LoaderCircle, ShoppingCart } from "lucide-react";
import "./store-showcase.css";

export type ShowcaseProduct = {
  id: string;
  src?: string;
  name: string;
  price?: string;
  preserveWhole?: boolean;
  state?: "risk" | "reject";
};

/** The format acceptance page and real task preview use this same markup and CSS. */
export default function StoreShowcase({ variant, products }: { variant: string; products: ShowcaseProduct[] }) {
  return <div className={`store-showcase ${variant}`} data-renderer="store-showcase">
    {products.map((product, index) => <article key={`${product.id}-${index}`} className={product.state ? `${product.state}-slot` : undefined}>
      {product.src ? <img src={product.src} alt={product.name} style={product.preserveWhole ? {objectFit:"contain"} : undefined}/> : <div className="showcase-loading"><LoaderCircle className="spin"/></div>}
      {product.preserveWhole && <small className="crop-warning">原图完整显示 · 待确认适配</small>}
      <strong>{product.name}</strong>
      <div className={product.price ? "showcase-meta with-price" : "showcase-meta"}>{product.price && <span className="showcase-price">{/^[¥￥]/.test(product.price) ? product.price : `¥${product.price}`}</span>}<ShoppingCart size={11} aria-hidden="true"/></div>
    </article>)}
  </div>;
}
