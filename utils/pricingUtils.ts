import { PrintJob, ShopSettings } from "../types";

export interface PriceCalculation {
  pricePerPage: number;
  totalPages: number;
  totalPrice: number;
  currency: string;
}

export const calculatePrintPrice = (
  job: PrintJob,
  settings: ShopSettings,
  actualPages: number = 1,
): PriceCalculation => {
  const pricing = settings.pricing || {
    colorPerPage: 30.0, // Default DZD prices
    blackWhitePerPage: 15.0,
  };

  const pricePerPage =
    job.printPreferences?.colorMode === "blackWhite"
      ? pricing.blackWhitePerPage
      : pricing.colorPerPage;

  const copies = job.printPreferences?.copies || 1;
  const totalPages = actualPages * copies;
  const totalPrice = pricePerPage * totalPages;

  return {
    pricePerPage,
    totalPages,
    totalPrice,
    currency: "DZD",
  };
};

export const countPdfPages = async (file: File): Promise<number> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        const view = new Uint8Array(arrayBuffer);

        // Simple PDF page counting - look for "/Type /Page" patterns
        let pageCount = 0;
        const text = new TextDecoder("latin1").decode(view);
        const pageMatches = text.match(/\/Type\s*\/Page[^s]/g);
        pageCount = pageMatches ? pageMatches.length : 1;

        // Fallback: look for "count" in catalog
        if (pageCount === 0) {
          const countMatch = text.match(/\/Count\s+(\d+)/);
          pageCount = countMatch ? parseInt(countMatch[1]) : 1;
        }

        resolve(Math.max(1, pageCount));
      } catch (error) {
        console.error("Error counting PDF pages:", error);
        resolve(1);
      }
    };
    reader.readAsArrayBuffer(file);
  });
};

export const countWordPages = async (file: File): Promise<number> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target?.result as ArrayBuffer;

        // For Word documents, estimate based on file size
        // Word docs are roughly 15-20KB per page
        const estimatedPages = Math.max(1, Math.ceil(file.size / 17500));
        resolve(estimatedPages);
      } catch (error) {
        console.error("Error counting Word pages:", error);
        resolve(1);
      }
    };
    reader.readAsArrayBuffer(file);
  });
};

export const getActualPageCount = async (file: File): Promise<number> => {
  const fileType = file.type.toLowerCase();

  if (fileType.includes("pdf")) {
    return await countPdfPages(file);
  } else if (fileType.includes("word") || fileType.includes("document")) {
    return await countWordPages(file);
  } else if (fileType.includes("image")) {
    return 1;
  } else {
    // Fallback estimation for other file types
    return Math.max(1, Math.ceil(file.size / 75000));
  }
};

export const formatPrice = (
  price: number,
  currency: string = "DZD",
): string => {
  return `${price.toFixed(2)} ${currency}`;
};

export const calculateCustomerTotal = (
  jobs: PrintJob[],
  settings: ShopSettings,
  pageCounts: { [jobId: string]: number },
): number => {
  return jobs.reduce((total, job) => {
    const actualPages = pageCounts[job.id] || 1;
    const price = calculatePrintPrice(job, settings, actualPages);
    return total + price.totalPrice;
  }, 0);
};
