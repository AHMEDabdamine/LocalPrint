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
  pageCount?: number; // Number of pages for PDF files
  fileBlob?: Blob; // In a real app, this is a URL/Path on server
  printPreferences?: {
    colorMode: "color" | "blackWhite";
    copies: number;
  };
}

export interface ShopSettings {
  shopName: string;
  logoUrl: string | null;
  pricing?: {
    colorPerPage: number;
    blackWhitePerPage: number;
  };
}

export type Language = "en" | "ar";

export interface Translations {
  [key: string]: {
    en: string;
    ar: string;
  };
}

export type DiscountType = "percent" | "fixed";
export type ConditionType = "pages" | "amount";

export interface DiscountRule {
  id: string;
  name: string;
  discount_type: DiscountType;
  discount_value: number;
  condition_type: ConditionType;
  threshold: number;
  max_discount_cap: number | null;
  priority: number;
  is_active: boolean;
  created_at?: string;
}

export interface DiscountResult {
  rule: DiscountRule | null;
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
  savingsPercentage: number;
}
