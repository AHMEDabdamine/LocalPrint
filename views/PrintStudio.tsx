import React, { useState } from "react";
import CardIDTool from "./CardIDTool";
import PDFJobManager from "./PDFJobManager";
import { useLanguage } from "../lib/useLanguage";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";

type StudioTab = "cards" | "pdf";

const PrintStudio: React.FC = () => {
  const { t } = useLanguage();
  const [tab, setTab] = useState<StudioTab>("cards");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1 -ml-2">
        <Button variant="ghost" size="sm" onClick={() => window.location.hash = "admin"}>
          <svg className="w-4 h-4 rtl:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
          </svg>
          {t("dashboard")}
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-t-2xl border-b">
            <Button
              variant={tab === "cards" ? "default" : "ghost"}
              size="sm"
              onClick={() => setTab("cards")}
              className="rounded-lg"
            >
              {t("cardsTab")}
            </Button>
            <Button
              variant={tab === "pdf" ? "default" : "ghost"}
              size="sm"
              onClick={() => setTab("pdf")}
              className="rounded-lg"
            >
              {t("pdfTab")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div>
        {tab === "cards" ? <CardIDTool /> : <PDFJobManager />}
      </div>
    </div>
  );
};

export default PrintStudio;
