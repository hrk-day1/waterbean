import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet } from "react-router-dom";
import { PanelLeftClose, PanelLeftOpen, Settings, Sprout } from "lucide-react";
import { cn } from "@/shared/lib/utils";

export function ShellLayout() {
  const { t } = useTranslation();
  const [isMdUp, setIsMdUp] = useState(
    typeof window !== "undefined" ? window.matchMedia("(min-width: 768px)").matches : true,
  );
  const [asideOpen, setAsideOpen] = useState(
    typeof window !== "undefined" ? window.matchMedia("(min-width: 768px)").matches : true,
  );

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = () => setIsMdUp(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const closeAside = () => setAsideOpen(false);
  const openAside = () => setAsideOpen(true);
  const closeAsideMobile = () => {
    if (!isMdUp) setAsideOpen(false);
  };

  const navClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
      isActive
        ? "bg-accent/15 text-accent"
        : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
    );

  const showOverlay = asideOpen && !isMdUp;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-zinc-50/50">
      {showOverlay && (
        <button
          type="button"
          aria-label={t("layout.overlayClose")}
          className="fixed inset-0 z-40 bg-zinc-900/40 md:hidden"
          onClick={closeAsideMobile}
        />
      )}

      {!asideOpen && (
        <button
          type="button"
          onClick={openAside}
          className="fixed left-3 top-3 z-30 flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-white text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50"
          aria-expanded={false}
          aria-controls="app-aside-nav"
          aria-label={t("layout.menuExpand")}
        >
          <PanelLeftOpen className="h-5 w-5" aria-hidden />
        </button>
      )}

      <div className="flex min-h-0 flex-1 basis-0">
        <aside
          id="app-aside-nav"
          className={cn(
            "flex flex-col border-r border-border bg-white duration-200 ease-out",
            isMdUp
              ? cn(
                  "relative z-0 h-full min-h-0 shrink-0 self-stretch transition-[width]",
                  asideOpen ? "w-56" : "w-0 overflow-hidden border-transparent",
                )
              : cn(
                  "fixed inset-y-0 left-0 z-50 w-56 max-w-[85vw] shadow-lg transition-transform",
                  asideOpen ? "translate-x-0" : "-translate-x-full pointer-events-none",
                ),
          )}
          aria-hidden={!asideOpen}
        >
          <div className="flex h-full min-h-0 min-w-56 flex-col">
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-2">
              <img
                src="/waterbean_v2.png"
                alt=""
                className="h-7 w-7 shrink-0 object-contain"
                width={28}
                height={28}
                decoding="async"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-zinc-900">{t("app.title")}</p>
                <p className="truncate text-xs text-zinc-500">{t("layout.asideSubtitle")}</p>
              </div>
              <button
                type="button"
                onClick={closeAside}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
                aria-controls="app-aside-nav"
                aria-label={t("layout.menuCollapse")}
              >
                <PanelLeftClose className="h-5 w-5" aria-hidden />
              </button>
            </div>

            <nav
              className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3"
              aria-label={t("layout.navLabel")}
            >
              <NavLink to="/waterbean" className={navClass} onClick={closeAsideMobile} end>
                <Sprout className="h-4 w-4 shrink-0" aria-hidden />
                {t("nav.waterbean")}
              </NavLink>
            </nav>

            <div className="shrink-0 border-t border-border p-3">
              <NavLink to="/setting" className={navClass} onClick={closeAsideMobile}>
                <Settings className="h-4 w-4 shrink-0" aria-hidden />
                {t("nav.settings")}
              </NavLink>
            </div>
          </div>
        </aside>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain">
          <div className={cn("mx-auto max-w-5xl p-6", !asideOpen ? "pt-14" : "pt-6")}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
