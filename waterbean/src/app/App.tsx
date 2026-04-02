import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PipelinePage } from "@/features/pipeline/view/pipeline-page";
import { ForkPage } from "@/features/fork/view/fork-page";
import { cn } from "@/shared/lib/utils";

type Tab = "pipeline" | "fork";

const TAB_IDS: Tab[] = ["pipeline", "fork"];

export function App() {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>("pipeline");

  const toggleLang = () => {
    const next = i18n.language === "ko" ? "en" : "ko";
    i18n.changeLanguage(next);
    localStorage.setItem("lang", next);
    document.documentElement.lang = next;
  };

  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="flex items-center gap-1 text-2xl font-bold tracking-tight">
            <img
              src="/waterbean_v2.png"
              alt=""
              className="h-[1em] w-[1em] shrink-0 object-contain"
              width={24}
              height={24}
              decoding="async"
            />
            {t("app.title")}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">{t("app.description")}</p>
        </div>
        <button
          type="button"
          onClick={toggleLang}
          className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100"
        >
          {i18n.language === "ko" ? "EN" : "KO"}
        </button>
      </header>

      <nav className="mb-6 flex gap-1 border-b border-border">
        {TAB_IDS.map((id) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors",
              tab === id
                ? "border-b-2 border-accent text-accent"
                : "text-zinc-500 hover:text-zinc-700",
            )}
          >
            {t(`tab.${id}`)}
            <span className="ml-1.5 text-xs font-normal opacity-60">
              {t(`tab.${id}.desc`)}
            </span>
          </button>
        ))}
      </nav>

      {tab === "pipeline" && <PipelinePage />}
      {tab === "fork" && <ForkPage />}
    </div>
  );
}
