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
        const bytes = new Uint8Array(arrayBuffer);

        // Decode using latin1 to keep byte values intact
        const text = new TextDecoder("latin1").decode(bytes);

        // Strategy 1: Find /Count N in the Pages dictionary
        // This is the most reliable – it's the total page count stored in the catalog
        const countMatches = text.match(/\/Count\s+(\d+)/g);
        if (countMatches && countMatches.length > 0) {
          // The last /Count value is usually the root Pages node
          const counts = countMatches.map((m) =>
            parseInt(m.replace(/\/Count\s+/, ""), 10),
          );
          const maxCount = Math.max(...counts);
          if (maxCount > 0) {
            resolve(maxCount);
            return;
          }
        }

        // Strategy 2: Count /Type /Page objects (not /Pages)
        const pageMatches = text.match(/\/Type\s*\/Page(?!s)/g);
        if (pageMatches && pageMatches.length > 0) {
          resolve(pageMatches.length);
          return;
        }

        // Fallback: estimate from file size (~75KB per page for PDFs)
        const estimated = Math.max(1, Math.ceil(file.size / 75000));
        resolve(estimated);
      } catch (error) {
        console.error("Error counting PDF pages:", error);
        resolve(1);
      }
    };
    reader.onerror = () => resolve(1);
    reader.readAsArrayBuffer(file);
  });
};

export const countWordPages = async (file: File): Promise<number> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        const bytes = new Uint8Array(arrayBuffer);

        // DOCX files are ZIP archives – try to find the word/document.xml and
        // look for a <w:pages> value stored in the document properties.
        // As a heuristic we decode the binary and search for the pages property.
        const text = new TextDecoder("latin1").decode(bytes);

        // Check for <Pages>N</Pages> in docProps/app.xml (inside the zip)
        const pagesMatch = text.match(/<Pages>(\d+)<\/Pages>/);
        if (pagesMatch) {
          resolve(Math.max(1, parseInt(pagesMatch[1], 10)));
          return;
        }

        // Fallback: estimate based on file size.
        // Average DOCX is ~40KB overhead + ~8KB per page of plain text.
        // This is a rough heuristic; real content varies.
        const estimated = Math.max(1, Math.round((file.size - 40000) / 8000));
        resolve(Math.max(1, estimated));
      } catch (error) {
        console.error("Error counting Word pages:", error);
        resolve(1);
      }
    };
    reader.onerror = () => resolve(1);
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
