export type SlotRole = "hero" | "scene" | "product" | "detail" | "category";
export type SlotDefinition = { ratio: `${number}:${number}`; role: SlotRole; originalAllowed: boolean; crossProductAllowed: boolean };
const slot = (ratio: SlotDefinition["ratio"], role: SlotRole, originalAllowed = false, crossProductAllowed = false): SlotDefinition => ({ ratio, role, originalAllowed, crossProductAllowed });

export const storeFormatRegistry = {
  shopSign: { label: "店铺招牌", placement: "fixed-top", variants: {
    default: { label: "默认", size: [1080, 720], containerRatio: "3:2", slots: [slot("3:2", "hero")] },
    classic: { label: "经典", size: [1080, 576], containerRatio: "15:8", slots: [slot("15:8", "hero")] },
    minimal: { label: "极简", size: null, containerRatio: "6:1", slots: [], textRegion: "center" },
  }},
  carousel: { label: "轮播图", variants: {
    small: { label: "小图", size: [1080, 360], containerRatio: "3:1", slots: [slot("3:1", "hero")] },
    medium: { label: "中图", size: [1080, 810], containerRatio: "4:3", slots: [slot("4:3", "hero")] },
    large: { label: "大图", size: [1080, 1440], containerRatio: "3:4", slots: [slot("3:4", "hero")] },
  }},
  navigation: { label: "导航栏", variants: {
    four: { label: "每行4个", size: [168, 168], containerRatio: "4:1", slots: Array.from({ length: 4 }, () => slot("1:1", "category", true)) },
    five: { label: "每行5个", size: [168, 168], containerRatio: "5:1", slots: Array.from({ length: 5 }, () => slot("1:1", "category", true)) },
  }},
  showcase: { label: "商品橱窗", variants: {
    single: { label: "单列", size: null, containerRatio: "1:1", slots: [slot("1:1", "product", true)] },
    double: { label: "双列", size: null, containerRatio: "2:1", slots: Array.from({ length: 2 }, () => slot("1:1", "product", true, true)) },
    triple: { label: "三列", size: null, containerRatio: "3:1", slots: Array.from({ length: 3 }, () => slot("1:1", "product", true, true)) },
    slider: { label: "横向滑动", size: null, containerRatio: "5:2", slots: Array.from({ length: 4 }, () => slot("1:1", "product", true, true)) },
  }},
  poster: { label: "海报", variants: {
    single: { label: "单列", size: [1080, 1080], containerRatio: "1:1", slots: [slot("1:1", "scene")] },
    double: { label: "双列", size: [540, 1080], containerRatio: "1:1", slots: Array.from({ length: 2 }, () => slot("1:2", "scene", false, true)) },
    triple: { label: "三列", size: [360, 1080], containerRatio: "1:1", slots: Array.from({ length: 3 }, () => slot("1:3", "scene", false, true)) },
    slider: { label: "多图滑动", size: [810, 1080], containerRatio: "3:4", slots: Array.from({ length: 3 }, () => slot("3:4", "scene", false, true)) },
    combo1: { label: "三图组合1", size: [1080, 1080], containerRatio: "1:1", slots: [slot("1:2", "hero"), slot("1:1", "product"), slot("1:1", "detail")] },
    combo2: { label: "三图组合2", size: [1080, 1080], containerRatio: "1:1", slots: [slot("1:1", "product"), slot("1:1", "detail"), slot("1:2", "hero")] },
    combo3: { label: "三图组合3", size: [1080, 1080], containerRatio: "1:1", slots: [slot("2:1", "scene"), slot("1:1", "product"), slot("1:1", "detail")] },
  }},
  text: { label: "公告和文本", variants: {
    singleLine: { label: "单行", size: null, containerRatio: "12:1", slots: [], textRegion: "single-line" },
    multiLine: { label: "多行", size: null, containerRatio: "4:1", slots: [], textRegion: "multi-line-200" },
    link: { label: "文字链接", size: null, containerRatio: "10:1", slots: [], textRegion: "link-visual-only" },
  }},
} as const;

export type StoreFormatType = keyof typeof storeFormatRegistry;
export type StoreFormatVariant<T extends StoreFormatType = StoreFormatType> = keyof (typeof storeFormatRegistry)[T]["variants"] & string;
export const bodyModuleRange = { min: 3, max: 8 } as const;
export const formatCount = Object.values(storeFormatRegistry).reduce((sum, format) => sum + Object.keys(format.variants).length, 0);
export function isStoreVariant(type: string, variant: string): boolean { return type in storeFormatRegistry && variant in storeFormatRegistry[type as StoreFormatType].variants; }
