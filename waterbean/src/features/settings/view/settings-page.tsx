import { useTranslation } from "react-i18next";
import { Card } from "@/shared/ui/card";

export function SettingsPage() {
  const { t, i18n } = useTranslation();

  const setLang = (lng: "ko" | "en") => {
    i18n.changeLanguage(lng);
    localStorage.setItem("lang", lng);
    document.documentElement.lang = lng;
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-zinc-900">{t("settings.title")}</h2>
        <p className="mt-1 text-sm text-zinc-500">{t("settings.subtitle")}</p>
      </div>

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-zinc-800">{t("settings.languageSection")}</h3>
        <p className="mt-1 text-xs text-zinc-500">{t("settings.languageDesc")}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setLang("ko")}
            className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
              i18n.language === "ko"
                ? "border-accent bg-accent/10 text-accent"
                : "border-border text-zinc-600 hover:bg-zinc-50"
            }`}
          >
            {t("settings.langKo")}
          </button>
          <button
            type="button"
            onClick={() => setLang("en")}
            className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
              i18n.language === "en"
                ? "border-accent bg-accent/10 text-accent"
                : "border-border text-zinc-600 hover:bg-zinc-50"
            }`}
          >
            {t("settings.langEn")}
          </button>
        </div>
      </Card>
    </div>
  );
}
