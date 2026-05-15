import { PrintJob, PrintStatus, ShopSettings, DiscountRule } from "../types";

class StorageService {
  private async safeFetch(url: string, options?: RequestInit) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          Accept: "application/json",
          ...(options?.headers || {}),
        },
      });

      const text = await response.text();

      if (!response.ok) {
        console.error(`Server error (${response.status}):`, text);
        throw new Error(`Server error: ${response.status}`);
      }

      if (!text) return {};

      try {
        return JSON.parse(text);
      } catch (parseError) {
        console.error("Failed to parse JSON response:", text);
        throw new Error("Malformed JSON response from server");
      }
    } catch (err) {
      console.error(`Fetch failed for ${url}:`, err);
      throw err;
    }
  }

  async saveJob(
    job: PrintJob,
    file: File,
    onProgress?: (p: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("metadata", JSON.stringify(job));

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/upload", true);
      xhr.setRequestHeader("Accept", "application/json");

      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            onProgress(percent);
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText);
            const myJobs = this.getMyJobIds();
            myJobs.push(response.job.id);
            localStorage.setItem("my_upload_ids", JSON.stringify(myJobs));
            resolve();
          } catch (e) {
            reject(new Error("Malformed response from server"));
          }
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.send(formData);
    });
  }

  // New method to replace a file for an existing job
  async updateJobFile(jobId: string, file: File): Promise<void> {
    const formData = new FormData();
    formData.append("file", file);

    await this.safeFetch(`/api/jobs/${jobId}/file`, {
      method: "POST",
      body: formData,
    });
  }

  async getMetadata(): Promise<PrintJob[]> {
    const data = await this.safeFetch("/api/jobs");
    return Array.isArray(data) ? data : [];
  }

  getMyJobIds(): string[] {
    try {
      const data = localStorage.getItem("my_upload_ids");
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  async getMyRecentJobs(): Promise<PrintJob[]> {
    try {
      const all = await this.getMetadata();
      const myIds = this.getMyJobIds();
      return all
        .filter((j) => myIds.includes(j.id))
        .sort(
          (a, b) =>
            new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime()
        );
    } catch (e) {
      return [];
    }
  }

  async getFileUrl(id: string): Promise<string | null> {
    try {
      const jobs = await this.getMetadata();
      const job = jobs.find((j) => j.id === id);
      if (!job || !(job as any).serverFileName) return null;
      return `/api/files/${(job as any).serverFileName}`;
    } catch (e) {
      return null;
    }
  }

  async updateStatus(id: string, status: PrintStatus): Promise<void> {
    await this.safeFetch(`/api/jobs/${id}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  }

  async updateJobPreferences(
    id: string,
    preferences: { colorMode: "color" | "blackWhite"; copies: number; paperType?: string },
  ): Promise<void> {
    await this.safeFetch(`/api/jobs/${id}/preferences`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(preferences),
    });
  }

  async saveSettings(settings: {
    shopName?: string;
    paperTypes?: import("../types").PaperType[];
    pricing?: { colorPerPage: number; blackWhitePerPage: number; glossyPerPage?: number; cardboardPerPage?: number };
  }): Promise<void> {
    await this.safeFetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
  }

  async deleteJob(id: string): Promise<void> {
    await this.safeFetch(`/api/jobs/${id}`, { method: "DELETE" });
    const myJobs = this.getMyJobIds().filter((mid) => mid !== id);
    localStorage.setItem("my_upload_ids", JSON.stringify(myJobs));
  }

  async getSettings(): Promise<ShopSettings> {
    try {
      const settings = await this.safeFetch("/api/settings");
      const pricing = settings?.pricing
        ? {
            colorPerPage: Number(settings.pricing.colorPerPage) || 30.0,
            blackWhitePerPage: Number(settings.pricing.blackWhitePerPage) || 15.0,
            glossyPerPage: Number(settings.pricing.glossyPerPage) || 50.0,
            cardboardPerPage: Number(settings.pricing.cardboardPerPage) || 40.0,
          }
        : undefined;

      const defaultPaperTypes = [
        { id: "normal", name: "Normal", nameAr: "عادي", colorPerPage: pricing?.colorPerPage ?? 30.0, blackWhitePerPage: pricing?.blackWhitePerPage ?? 15.0 },
        { id: "glossy", name: "Glossy", nameAr: "لامع", colorPerPage: pricing?.glossyPerPage ?? 50.0, blackWhitePerPage: pricing?.glossyPerPage ?? 50.0 },
        { id: "cardboard", name: "Cardboard", nameAr: "ورق مقوى", colorPerPage: pricing?.cardboardPerPage ?? 40.0, blackWhitePerPage: pricing?.cardboardPerPage ?? 40.0 },
      ];

      return {
        shopName: settings?.shopName || "PrintShop Hub",
        logoUrl: settings?.logoUrl || null,
        pricing,
        paperTypes: Array.isArray(settings?.paperTypes) && settings.paperTypes.length > 0
          ? settings.paperTypes
          : defaultPaperTypes,
      };
    } catch (e) {
      return { shopName: "PrintShop Hub", logoUrl: null };
    }
  }

  async uploadLogo(file: File): Promise<string> {
    const formData = new FormData();
    formData.append("logo", file);

    const response = await this.safeFetch("/api/settings/logo", {
      method: "POST",
      body: formData,
    });
    return response.logoUrl;
  }

  // Paper Types
  async getPaperTypes(): Promise<import("../types").PaperType[]> {
    return this.safeFetch("/api/paper-types");
  }

  async createPaperType(pt: import("../types").PaperType): Promise<import("../types").PaperType> {
    return this.safeFetch("/api/paper-types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pt),
    });
  }

  async updatePaperType(id: string, updates: Partial<import("../types").PaperType>): Promise<import("../types").PaperType> {
    return this.safeFetch(`/api/paper-types/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
  }

  async deletePaperType(id: string): Promise<void> {
    await this.safeFetch(`/api/paper-types/${id}`, { method: "DELETE" });
  }

  // Discount Rules
  async getDiscountRules(): Promise<DiscountRule[]> {
    return this.safeFetch("/api/discount-rules");
  }

  async getActiveDiscountRules(): Promise<DiscountRule[]> {
    return this.safeFetch("/api/discount-rules/active");
  }

  async createDiscountRule(rule: DiscountRule): Promise<DiscountRule> {
    return this.safeFetch("/api/discount-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rule),
    });
  }

  async updateDiscountRule(id: string, updates: Partial<DiscountRule>): Promise<DiscountRule> {
    return this.safeFetch(`/api/discount-rules/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
  }

  async deleteDiscountRule(id: string): Promise<void> {
    await this.safeFetch(`/api/discount-rules/${id}`, {
      method: "DELETE",
    });
  }

  async verifyPassword(password: string): Promise<boolean> {
    try {
      const result = await this.safeFetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      return result.success === true;
    } catch {
      return false;
    }
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.safeFetch("/api/settings/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }
}

export const storageService = new StorageService();
