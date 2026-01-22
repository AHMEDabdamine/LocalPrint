
export enum PrintStatus {
  PENDING = 'PENDING',
  PRINTED = 'PRINTED'
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
}

export interface ShopSettings {
  shopName: string;
  logoUrl: string | null;
}

export type Language = 'en' | 'ar';

export interface Translations {
  [key: string]: {
    en: string;
    ar: string;
  };
}
