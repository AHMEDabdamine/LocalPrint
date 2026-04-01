export enum PrintStatus {
  PENDING = "PENDING",
  PRINTED = "PRINTED",
}

export interface PrintJob {
  id: string;
  customerName: string;
  phoneNumber: string;
  notes: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadDate: string;
  status: PrintStatus;
  fileBlob?: Blob; // In a real app, this is a URL/Path on server
  printPreferences?: {
    colorMode: "color" | "blackWhite";
    copies: number;
  };
}

export interface DiscountRule {
  id: string;
  name: string;
  enabled: boolean;
  thresholdType: "pageCount" | "itemQuantity" | "orderTotal" | "mixed";
  conditions: {
    minPages?: number;
    minItems?: number;
    minOrderTotal?: number;
    requireAll?: boolean; // For mixed type - require all conditions or any
  };
  discountType: "percentage" | "fixedAmount";
  discountValue: number; // Percentage (0-100) or fixed amount
  description?: string;
}

export interface DiscountSettings {
  enabled: boolean;
  rules: DiscountRule[];
  allowStacking: boolean; // Allow multiple discounts to apply
  maxDiscount?: number; // Maximum discount percentage or amount
}

export interface ShopSettings {
  shopName: string;
  logoUrl: string | null;
  pricing?: {
    colorPerPage: number;
    blackWhitePerPage: number;
  };
  discounts?: DiscountSettings;
}

export type Language = "en" | "ar";

export interface Translations {
  [key: string]: {
    en: string;
    ar: string;
  };
}
