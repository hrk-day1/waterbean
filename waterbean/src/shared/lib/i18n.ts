import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import ko from "@/shared/locales/ko.json" with { type: "json" }
import en from "@/shared/locales/en.json" with { type: "json" }

i18n.use(initReactI18next).init({
  resources: {
    ko: { translation: ko },
    en: { translation: en },
  },
  lng: localStorage.getItem("lang") ?? "ko",
  fallbackLng: "ko",
  interpolation: { escapeValue: false },
})

export default i18n
