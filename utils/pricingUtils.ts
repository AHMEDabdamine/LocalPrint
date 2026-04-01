import {
  PrintJob,
  ShopSettings,
  DiscountRule,
  DiscountSettings,
} from "../types";

export interface PriceCalculation {
  pricePerPage: number;
  totalPages: number;
  totalPrice: number;
  currency: string;
  discounts?: AppliedDiscount[];
  finalPrice: number;
  totalDiscount: number;
}

export interface AppliedDiscount {
  ruleId: string;
  ruleName: string;
  discountAmount: number;
  discountType: "percentage" | "fixedAmount";
}

export interface OrderSummary {
  totalItems: number;
  totalPages: number;
  subtotal: number;
  discounts: AppliedDiscount[];
  totalDiscount: number;
  finalPrice: number;
}

export const calculatePrintPrice = (
  job: PrintJob,
  settings: ShopSettings,
  actualPages: number = 1,
): PriceCalculation => {
  const pricing = settings.pricing || {
    colorPerPage: 10.0, // Default DZD prices
    blackWhitePerPage: 8.0,
  };

  const pricePerPage =
    job.printPreferences?.colorMode === "blackWhite"
      ? pricing.blackWhitePerPage
      : pricing.colorPerPage;

  const copies = job.printPreferences?.copies || 1;
  const totalPages = actualPages * copies;
  const totalPrice = pricePerPage * totalPages;

  // Calculate discounts for single job
  const { discounts, totalDiscount, finalPrice } = calculateDiscounts(
    [
      {
        ...job,
        calculatedPages: actualPages,
        calculatedPrice: totalPrice,
      },
    ],
    settings.discounts,
    settings,
  );

  return {
    pricePerPage,
    totalPages,
    totalPrice,
    currency: "DZD",
    discounts,
    finalPrice,
    totalDiscount,
  };
};

export const calculateDiscounts = (
  jobs: (PrintJob & { calculatedPages?: number; calculatedPrice?: number })[],
  discountSettings: DiscountSettings | undefined,
  settings: ShopSettings,
): {
  discounts: AppliedDiscount[];
  totalDiscount: number;
  finalPrice: number;
} => {
  if (!discountSettings?.enabled || !discountSettings.rules.length) {
    const subtotal = jobs.reduce(
      (sum, job) => sum + (job.calculatedPrice || 0),
      0,
    );
    return {
      discounts: [],
      totalDiscount: 0,
      finalPrice: subtotal,
    };
  }

  const orderSummary = getOrderSummary(jobs);
  const applicableRules = discountSettings.rules.filter(
    (rule) => rule.enabled && isRuleApplicable(rule, orderSummary),
  );

  let discounts: AppliedDiscount[] = [];
  let totalDiscount = 0;

  if (discountSettings.allowStacking) {
    // Apply all applicable discounts
    for (const rule of applicableRules) {
      const discountAmount = calculateRuleDiscount(rule, orderSummary);
      if (discountAmount > 0) {
        discounts.push({
          ruleId: rule.id,
          ruleName: rule.name,
          discountAmount,
          discountType: rule.discountType,
        });
        totalDiscount += discountAmount;
      }
    }
  } else {
    // Apply only the best discount
    let bestDiscount = 0;
    let bestRule: DiscountRule | null = null;

    for (const rule of applicableRules) {
      const discountAmount = calculateRuleDiscount(rule, orderSummary);
      if (discountAmount > bestDiscount) {
        bestDiscount = discountAmount;
        bestRule = rule;
      }
    }

    if (bestRule) {
      discounts.push({
        ruleId: bestRule.id,
        ruleName: bestRule.name,
        discountAmount: bestDiscount,
        discountType: bestRule.discountType,
      });
      totalDiscount = bestDiscount;
    }
  }

  // Apply maximum discount limit
  if (
    discountSettings.maxDiscount &&
    totalDiscount > discountSettings.maxDiscount
  ) {
    totalDiscount = discountSettings.maxDiscount;
    if (discounts.length > 0) {
      discounts = discounts.map((d) => ({
        ...d,
        discountAmount: totalDiscount,
      }));
      if (!discountSettings.allowStacking) {
        discounts = discounts.slice(0, 1);
      }
    }
  }

  const subtotal = jobs.reduce(
    (sum, job) => sum + (job.calculatedPrice || 0),
    0,
  );
  const finalPrice = Math.max(0, subtotal - totalDiscount);

  return { discounts, totalDiscount, finalPrice };
};

export const getOrderSummary = (
  jobs: (PrintJob & { calculatedPages?: number; calculatedPrice?: number })[],
): OrderSummary => {
  const totalItems = jobs.length;
  const totalPages = jobs.reduce(
    (sum, job) =>
      sum + (job.calculatedPages || 1) * (job.printPreferences?.copies || 1),
    0,
  );
  const subtotal = jobs.reduce(
    (sum, job) => sum + (job.calculatedPrice || 0),
    0,
  );

  return {
    totalItems,
    totalPages,
    subtotal,
    discounts: [],
    totalDiscount: 0,
    finalPrice: subtotal,
  };
};

export const isRuleApplicable = (
  rule: DiscountRule,
  orderSummary: OrderSummary,
): boolean => {
  const { conditions } = rule;

  switch (rule.thresholdType) {
    case "pageCount":
      return conditions.minPages
        ? orderSummary.totalPages >= conditions.minPages
        : false;

    case "itemQuantity":
      return conditions.minItems
        ? orderSummary.totalItems >= conditions.minItems
        : false;

    case "orderTotal":
      return conditions.minOrderTotal
        ? orderSummary.subtotal >= conditions.minOrderTotal
        : false;

    case "mixed":
      const pageCondition =
        !conditions.minPages || orderSummary.totalPages >= conditions.minPages;
      const itemCondition =
        !conditions.minItems || orderSummary.totalItems >= conditions.minItems;
      const totalCondition =
        !conditions.minOrderTotal ||
        orderSummary.subtotal >= conditions.minOrderTotal;

      if (conditions.requireAll) {
        return pageCondition && itemCondition && totalCondition;
      } else {
        return pageCondition || itemCondition || totalCondition;
      }

    default:
      return false;
  }
};

export const calculateRuleDiscount = (
  rule: DiscountRule,
  orderSummary: OrderSummary,
): number => {
  const baseAmount = orderSummary.subtotal;

  switch (rule.discountType) {
    case "percentage":
      return (baseAmount * rule.discountValue) / 100;

    case "fixedAmount":
      return Math.min(rule.discountValue, baseAmount);

    default:
      return 0;
  }
};

export const countPdfPages = async (file: File): Promise<number> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        const view = new Uint8Array(arrayBuffer);

        // Improved PDF page counting - look for "/Type /Page" patterns
        let pageCount = 0;
        const text = new TextDecoder("latin1").decode(view);

        // Look for "/Type /Page" (not followed by 's' to avoid matching "/Type /Pages")
        const pageMatches = text.match(/\/Type\s*\/Page(?!\s*\/S)/g);
        pageCount = pageMatches ? pageMatches.length : 0;

        // Fallback 1: Look for "/Count" in the catalog (more reliable)
        if (pageCount === 0) {
          const countMatch = text.match(/\/Count\s+(\d+)/);
          if (countMatch) {
            pageCount = parseInt(countMatch[1]);
          }
        }

        // Fallback 2: Look for "endobj" patterns that indicate page objects
        if (pageCount === 0) {
          const endobjMatches = text.match(/endobj/g);
          // Rough estimate: assume every 3-4 endobj markers might be a page
          pageCount = endobjMatches ? Math.ceil(endobjMatches.length / 3) : 1;
        }

        // Final fallback
        if (pageCount === 0) {
          pageCount = 1;
        }

        console.log(`PDF ${file.name}: ${pageCount} pages detected`);
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

        // For Word documents, use improved estimation based on file size
        // Modern Word docs: ~15-20KB per page for text, more for images
        const fileSizeKB = file.size / 1024;

        let estimatedPages: number;

        if (fileSizeKB < 50) {
          // Very small document (1-3 pages)
          estimatedPages = Math.max(1, Math.ceil(fileSizeKB / 20));
        } else if (fileSizeKB < 200) {
          // Small to medium document (4-15 pages)
          estimatedPages = Math.max(1, Math.ceil(fileSizeKB / 18));
        } else if (fileSizeKB < 1000) {
          // Medium document (16-60 pages)
          estimatedPages = Math.max(1, Math.ceil(fileSizeKB / 16));
        } else {
          // Large document (60+ pages)
          estimatedPages = Math.max(1, Math.ceil(fileSizeKB / 15));
        }

        console.log(
          `Word ${file.name}: ${fileSizeKB.toFixed(1)}KB, estimated ${estimatedPages} pages`,
        );
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
  const fileName = file.name.toLowerCase();

  console.log(
    `Counting pages for ${file.name} (${fileType}, ${(file.size / 1024).toFixed(1)}KB)`,
  );

  try {
    let pageCount: number;

    if (fileType.includes("pdf") || fileName.endsWith(".pdf")) {
      pageCount = await countPdfPages(file);
    } else if (
      fileType.includes("word") ||
      fileType.includes("document") ||
      fileName.endsWith(".doc") ||
      fileName.endsWith(".docx")
    ) {
      pageCount = await countWordPages(file);
    } else if (
      fileType.includes("image") ||
      fileName.endsWith(".jpg") ||
      fileName.endsWith(".jpeg") ||
      fileName.endsWith(".png") ||
      fileName.endsWith(".gif") ||
      fileName.endsWith(".bmp") ||
      fileName.endsWith(".webp")
    ) {
      pageCount = 1;
      console.log(`Image ${file.name}: 1 page`);
    } else {
      // Fallback estimation for other file types
      pageCount = Math.max(1, Math.ceil(file.size / 75000));
      console.log(
        `Other file ${file.name}: estimated ${pageCount} pages based on size`,
      );
    }

    console.log(`Final page count for ${file.name}: ${pageCount}`);
    return pageCount;
  } catch (error) {
    console.error(`Error counting pages for ${file.name}:`, error);
    return 1;
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
): {
  subtotal: number;
  discounts: AppliedDiscount[];
  totalDiscount: number;
  finalPrice: number;
} => {
  const jobsWithPricing = jobs.map((job) => ({
    ...job,
    calculatedPages: pageCounts[job.id] || 1,
    calculatedPrice: calculatePrintPrice(job, settings, pageCounts[job.id] || 1)
      .totalPrice,
  }));

  const { discounts, totalDiscount, finalPrice } = calculateDiscounts(
    jobsWithPricing,
    settings.discounts,
    settings,
  );

  const subtotal = jobsWithPricing.reduce(
    (sum, job) => sum + job.calculatedPrice,
    0,
  );

  return {
    subtotal,
    discounts,
    totalDiscount,
    finalPrice,
  };
};
